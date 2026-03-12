import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '@/components/common/Header'
import Footer from '@/components/common/Footer'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'
import { useWallet } from '@/hooks/useWallet'
import { createHostedPaymentSession, collectBrowserInfo } from '@/lib/g2pay'
import { supabase } from '@/lib/supabase'
import { getReferral, clearReferral, setReferral } from '@/lib/referralTracking'
import { showErrorToast, showWarningToast } from '@/lib/toast'
import {
  OrderSummary,
  PromoCodeSection,
  WalletCreditSection,
  PriceSummary,
  ContactInformation,
  TermsCheckboxes,
  CardPayment,
} from './components'

function Checkout() {
  const navigate = useNavigate()
  const { items, removeItem, clearCart, getTotalPrice, validateCart } = useCartStore()
  const { isAuthenticated, isLoading: authLoading, isInitialized } = useAuthStore()
  const { summary } = useWallet()
  const [loading, setLoading] = useState(false)
  const [purchaseCompleted, setPurchaseCompleted] = useState(false)

  // Referral tracking state (handles both link referrals and manual codes)
  const [activeReferral, setActiveReferral] = useState<{ slug: string; influencerId: string; displayName?: string } | null>(null)
  const [influencerCode, setInfluencerCode] = useState('')

  // Payment state
  const [mobileNumber, setMobileNumber] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [cvv, setCvv] = useState('')
  const [cardholderName, setCardholderName] = useState('')
  const [appliedCredit, setAppliedCredit] = useState(0)
  const [promoCode, setPromoCode] = useState('')
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null)
  const [promoCodeType, setPromoCodeType] = useState<'percentage' | 'fixed_value' | null>(null)
  const [promoCodeValue, setPromoCodeValue] = useState(0)
  const [promoDiscount, setPromoDiscount] = useState(0)
  const [useWalletCredit, setUseWalletCredit] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [isUKResident, setIsUKResident] = useState(false)
  const [isOver18, setIsOver18] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  // Validate UK mobile number format
  const validateMobileNumber = (mobile: string): boolean => {
    // Remove spaces and check if it's a valid UK mobile
    const cleaned = mobile.replace(/\s/g, '')
    // UK mobile: starts with 07 and is 11 digits long
    return /^07\d{9}$/.test(cleaned)
  }

  const isMobileValid = validateMobileNumber(mobileNumber)

  // Validate card details
  const isCardValid = cardNumber.replace(/\s/g, '').length >= 13 &&
                      expiryDate.length === 5 &&
                      cvv.length >= 3 &&
                      cardholderName.trim().length >= 3

  const totalPrice = getTotalPrice()
  const availableCreditGBP = summary.availableBalance / 100
  const discountAmount = totalPrice * promoDiscount
  const priceAfterPromo = totalPrice - discountAmount
  const maxApplicableCredit = Math.min(availableCreditGBP, priceAfterPromo)
  const finalPrice = Math.max(0, priceAfterPromo - appliedCredit)
  const canProceed = finalPrice === 0 ?
    (agreeTerms && isUKResident && isOver18 && isMobileValid) :
    (agreeTerms && isUKResident && isOver18 && isMobileValid && isCardValid)

  useEffect(() => {
    // Wait for auth to initialize before checking authentication
    if (!isInitialized) {
      return
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
      navigate('/login?redirect=/checkout')
      return
    }

    // Redirect if cart is empty (but not if purchase was just completed)
    if (items.length === 0 && !purchaseCompleted) {
      navigate('/')
      return
    }
  }, [isAuthenticated, items, isInitialized, purchaseCompleted])

  // Load active referral on mount
  useEffect(() => {
    const loadReferral = async () => {
      const referral = getReferral()
      if (referral) {
        // Fetch influencer display name and slug (use maybeSingle to handle missing influencer gracefully)
        const { data: influencer } = await supabase
          .from('influencers')
          .select('display_name, slug')
          .eq('id', referral.influencerId)
          .maybeSingle()

        // Only set referral if influencer exists
        if (influencer) {
          setActiveReferral({
            slug: influencer.slug,
            influencerId: referral.influencerId,
            displayName: influencer.display_name
          })
        }
      }
    }
    loadReferral()
  }, [])

  // Load user's existing phone number from profile
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('phone')
            .eq('id', user.id)
            .single()

          if (profile?.phone) {
            // Format the phone number with spaces for better readability
            const formatted = profile.phone.replace(/(\d{5})(\d{6})/, '$1 $2')
            setMobileNumber(formatted)
          }
        }
      } catch (error) {
        console.error('Error loading user profile:', error)
      }
    }
    loadUserProfile()
  }, [])

  // Validate cart on mount
  useEffect(() => {
    const validateCartOnLoad = async () => {
      const result = await validateCart()
      if (result.removedCount > 0) {
        showWarningToast(
          `${result.removedCount} item(s) removed from cart: ${result.reasons.join(', ')}`
        )
      }
    }
    validateCartOnLoad()
  }, [])


  // Handle applying influencer code
  const handleApplyInfluencerCode = async () => {
    const code = influencerCode.trim().toLowerCase()

    if (!code) {
      showErrorToast('Please enter an influencer code')
      return
    }

    try {
      // Fetch influencer by slug
      const { data: influencer, error: influencerError } = await supabase
        .from('influencers')
        .select('id, user_id, slug, display_name, is_active')
        .eq('slug', code)
        .eq('is_active', true)
        .single()

      if (influencerError || !influencer) {
        showErrorToast('Invalid influencer code')
        return
      }

      // Save to localStorage and update state
      setReferral(influencer.id, influencer.slug)
      setActiveReferral({
        slug: influencer.slug,
        influencerId: influencer.id,
        displayName: influencer.display_name
      })
      setInfluencerCode('')
    } catch (err) {
      console.error('Error validating influencer code:', err)
      showErrorToast('Failed to validate code')
    }
  }

  // Handle removing influencer code
  const handleRemoveInfluencerCode = () => {
    clearReferral()
    setActiveReferral(null)
    setInfluencerCode('')
  }

  const handleApplyPromoCode = async () => {
    const code = promoCode.toUpperCase().trim()

    if (!code) {
      showErrorToast('Please enter a promo code')
      return
    }

    try {
      // Fetch promo code from backend
      const { data: promoCodeData, error: promoCodeError } = await supabase
        .from('promo_codes')
        .select('code, type, value, is_active, valid_from, valid_until, max_uses, current_uses, max_uses_per_user, min_order_pence')
        .eq('code', code)
        .eq('is_active', true)
        .single()

      if (promoCodeError || !promoCodeData) {
        showErrorToast('Invalid promo code')
        return
      }

      // Check if promo code is within valid date range
      const now = new Date()
      const validFrom = promoCodeData.valid_from ? new Date(promoCodeData.valid_from) : null
      const validUntil = promoCodeData.valid_until ? new Date(promoCodeData.valid_until) : null

      if (validFrom && now < validFrom) {
        showErrorToast('This promo code is not yet valid')
        return
      }

      if (validUntil && now > validUntil) {
        showErrorToast('This promo code has expired')
        return
      }

      // Check usage limits
      if (promoCodeData.max_uses && (promoCodeData.current_uses ?? 0) >= promoCodeData.max_uses) {
        showErrorToast('This promo code has reached its usage limit')
        return
      }

      // Check minimum order value
      const totalPence = Math.round(totalPrice * 100)
      if (promoCodeData.min_order_pence && totalPence < promoCodeData.min_order_pence) {
        const minOrderGBP = promoCodeData.min_order_pence / 100
        showErrorToast(`Minimum order value of £${minOrderGBP.toFixed(2)} required`)
        return
      }

      // Check if type is supported
      if (promoCodeData.type === 'percentage') {
        // Apply the promo code (value is 0-100, convert to 0-1)
        setAppliedPromoCode(promoCodeData.code)
        setPromoCodeType('percentage')
        setPromoCodeValue(promoCodeData.value)
        setPromoDiscount(promoCodeData.value / 100)
    setPromoCode('')
      } else if (promoCodeData.type === 'fixed_value') {
        // Fixed value in pence, convert to GBP and calculate as discount ratio
        const fixedDiscountGBP = promoCodeData.value / 100
        const discountRatio = Math.min(fixedDiscountGBP / totalPrice, 1)
        setAppliedPromoCode(promoCodeData.code)
        setPromoCodeType('fixed_value')
        setPromoCodeValue(promoCodeData.value)
        setPromoDiscount(discountRatio)
    setPromoCode('')
      } else if (promoCodeData.type === 'free_tickets') {
        // Calculate discount based on average ticket price and free tickets value
        const totalTickets = items.reduce((sum, item) => sum + item.quantity, 0)
        const averagePricePerTicket = totalTickets > 0 ? totalPrice / totalTickets : 0
        const freeTicketsValue = averagePricePerTicket * promoCodeData.value
        const discountRatio = Math.min(freeTicketsValue / totalPrice, 1)

        setAppliedPromoCode(promoCodeData.code)
        setPromoCodeType('fixed_value') // Display as fixed value discount
        setPromoCodeValue(Math.round(freeTicketsValue * 100)) // Store as pence
        setPromoDiscount(discountRatio)
    setPromoCode('')
      } else {
        showErrorToast('This promo code type is not supported for checkout')
      }
    } catch (err) {
      console.error('Error validating promo code:', err)
      showErrorToast('Failed to validate promo code')
    }
  }

  const handleRemovePromoCode = () => {
    setAppliedPromoCode(null)
    setPromoCodeType(null)
    setPromoCodeValue(0)
    setPromoDiscount(0)
  }

  const handleWalletToggle = (enabled: boolean) => {
    setUseWalletCredit(enabled)
    if (enabled) {
      setAppliedCredit(maxApplicableCredit)
    } else {
      setAppliedCredit(0)
    }
  }

  const handlePayment = async () => {
    try {
      setLoading(true)
      setPaymentError(null) // Clear previous errors

      // Validate cart is not empty
      if (items.length === 0) {
        throw new Error('Your cart is empty')
      }

      // Convert GBP to pence
      const totalPence = Math.round(totalPrice * 100)
      const creditPence = Math.round(appliedCredit * 100)
      const finalPence = Math.round(finalPrice * 100)
      const discountPence = Math.round(discountAmount * 100)

      // Validate order total is greater than 0
      if (totalPence <= 0) {
        throw new Error('Order total must be greater than £0.00. Please check your cart items.')
      }

      // Validate all items have valid prices
      const invalidItems = items.filter(
        (item) => !item.pricePerTicket || item.pricePerTicket <= 0 || !item.totalPrice || item.totalPrice <= 0
      )
      if (invalidItems.length > 0) {
        throw new Error(
          `Some items in your cart have invalid prices. Please remove and re-add: ${invalidItems.map((i) => i.competitionTitle).join(', ')}`
        )
      }

      // Ensure user is authenticated and refresh session to get latest token
      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession()

      if (sessionError) {
        console.error('[Checkout] Session refresh error:', sessionError)
        // Redirect to login if refresh fails
        navigate('/login?redirect=/checkout&error=session_expired')
        throw new Error('Your session has expired. Please log in again.')
      }

      if (!session?.user || !session?.access_token) {
        console.error('[Checkout] No valid session after refresh')
        navigate('/login?redirect=/checkout&error=no_session')
        throw new Error('User not authenticated. Please log in again.')
      }

      const authenticatedUserId = session.user.id

      // Get influencer data from active referral
      let influencerUserId: string | null = null

      if (activeReferral) {
        // Get the influencer's user_id from the influencers table
        const { data: influencerData } = await supabase
          .from('influencers')
          .select('user_id')
          .eq('id', activeReferral.influencerId)
          .single()

        if (influencerData) {
          influencerUserId = influencerData.user_id
        }
      }

      // Create order in database
      const orderData: {
        user_id: string
        subtotal_pence: number
        discount_pence: number
        credit_applied_pence: number
        total_pence: number
        status: 'pending'
        influencer_id?: string
      } = {
        user_id: authenticatedUserId,
        subtotal_pence: totalPence,
        discount_pence: discountPence,
        credit_applied_pence: creditPence,
        total_pence: finalPence,
        status: 'pending',
      }

      if (influencerUserId) {
        orderData.influencer_id = influencerUserId
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single()

      if (orderError) {
        console.error('Order creation error:', orderError)
        throw orderError
      }

      // Verify the order was created successfully
      const { data: verifyOrder, error: verifyError } = await supabase
        .from('orders')
        .select('id, user_id')
        .eq('id', order.id)
        .single()

      if (verifyError || !verifyOrder) {
        console.error('Order verification failed:', verifyError)
        throw new Error('Failed to verify order creation')
      }

      // Create order items
      const orderItems = items.map((item) => ({
        order_id: order.id,
        competition_id: item.competitionId,
        ticket_count: item.quantity,
        price_per_ticket_pence: Math.round(item.pricePerTicket * 100),
        total_pence: Math.round(item.totalPrice * 100),
      }))

      const { error: itemsError } = await supabase.from('order_items').insert(orderItems)

      if (itemsError) {
        console.error('❌ Order items error:', itemsError)
        throw itemsError
      }

      // Update user's phone number if provided
      if (mobileNumber) {
        const cleanedPhone = mobileNumber.replace(/\s/g, '')
        const { error: phoneUpdateError } = await supabase
          .from('profiles')
          .update({ phone: cleanedPhone })
          .eq('id', authenticatedUserId)

        if (phoneUpdateError) {
          console.error('Warning: Could not update phone number:', phoneUpdateError)
          // Don't fail the entire payment if phone update fails
        }
      }

      // If fully paid with wallet credit, complete order immediately
      if (finalPrice === 0) {
        // Complete order with wallet payment
        const { error: completeError } = await supabase.rpc('complete_order_with_wallet', {
          p_order_id: order.id,
          p_user_id: authenticatedUserId,
        })

        if (completeError) {
          console.error('❌ Error completing wallet order:', completeError)
          // Use the actual error message from the database
          throw new Error(completeError.message || 'Failed to process wallet payment')
        }

        // Send order confirmation email (non-blocking)
        import('@/services/email.service').then((emailServiceModule) => {
          const totalTickets = items.reduce((sum, item) => sum + item.quantity, 0)
          emailServiceModule.emailService.sendOrderConfirmationEmail(
            session.user.email || '',
            session.user.email?.split('@')[0] || 'Customer',
            {
              orderNumber: order.id.slice(0, 8).toUpperCase(),
              orderDate: new Date().toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
              totalTickets,
              orderTotal: (totalPrice / 100).toFixed(2),
              ticketsUrl: `${window.location.origin}/account?tab=tickets`
            }
          ).catch((err) => {
            console.error('Failed to send order confirmation email:', err)
          })
        })

        // Mark purchase as completed and clear cart
        setPurchaseCompleted(true)
        clearCart()
        navigate('/account?tab=tickets&purchase=success')
        return
      }

      // Validate mobile number
      if (!validateMobileNumber(mobileNumber)) {
        throw new Error('Please enter a valid UK mobile number (e.g., 07xxx xxxxxx)')
      }

      // Deduct wallet credits if any were applied (before payment)
      if (creditPence > 0) {
        await supabase.rpc('debit_wallet_credits', {
          p_user_id: authenticatedUserId,
          p_amount_pence: creditPence,
          p_description: `Order #${order.id.slice(0, 8)}`,
        })
      }

      // Parse card expiry
      const [expiryMonth, expiryYear] = expiryDate.split('/')

      // Collect browser info for 3DS v2
      const browserInfo = collectBrowserInfo()

      // Create Direct API payment with card details and browser info
      const paymentResult = await createHostedPaymentSession(
        order.id,
        session.user.email,
        mobileNumber,
        {
          cardNumber: cardNumber.replace(/\s/g, ''),
          expiryMonth: expiryMonth.trim(),
          expiryYear: expiryYear.trim(),
          cvv: cvv,
          cardholderName: cardholderName,
        },
        browserInfo
      )

      // Check if 3DS challenge is required
      if (paymentResult.requires3DS) {
        console.log('[Checkout] 3DS challenge required')

        // Store order ID and threeDSRef for later use
        localStorage.setItem('pendingOrderId', order.id)
        localStorage.setItem('threeDSRef', paymentResult.threeDSRef || '')

        // Redirect to 3DS challenge page with the ACS URL
        const params = new URLSearchParams({
          orderRef: order.id,
          threeDSURL: paymentResult.threeDSURL || '',
          threeDSRef: paymentResult.threeDSRef || '',
        })

        // Store 3DS request data
        if (paymentResult.threeDSRequest) {
          localStorage.setItem('threeDSRequest', JSON.stringify(paymentResult.threeDSRequest))
        }

        navigate(`/payment-3ds?${params.toString()}`)
        return
      }

      if (!paymentResult.success) {
        throw new Error(paymentResult.error || 'Failed to create payment session')
      }

      console.log('[Checkout] Payment processed successfully')

      // Mark purchase as completed and clear cart
      setPurchaseCompleted(true)
      clearCart()
      navigate('/account?tab=tickets&purchase=success')
    } catch (err) {
      console.error('Error processing payment:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to process payment'
      setPaymentError(errorMessage)
      showErrorToast(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // Show loading while auth is initializing
  if (!isInitialized || authLoading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#FFFCF9', color: '#2D251E' }}>
        <Header />
        <div className="flex items-center justify-center pt-24 pb-16 px-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: '#496B71' }}></div>
            <p className="text-gray-600">Loading checkout...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FFFCF9', color: '#2D251E' }}>
      <Header />

      {/* Processing Modal */}
      {loading && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-[#FF6B9D]/20 border-t-[#FF6B9D] rounded-full animate-spin"></div>
              <p className="text-sm text-[#2D251E]/60 font-medium">
                {finalPrice === 0 ? 'Processing order...' : 'Processing payment...'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="pt-20 sm:pt-24 pb-12 sm:pb-16 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <h1
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-6 sm:mb-8 md:mb-10"
            style={{ color: '#151e20', fontFamily: "'Fraunces', serif" }}
          >
            Secure Checkout
          </h1>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 md:gap-12">
            {/* Order Summary - Left Column */}
            <div className="order-2 lg:order-1 space-y-4 sm:space-y-6">
              <div
                className="p-4 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl shadow-sm"
                style={{
                  backgroundColor: 'white',
                  borderWidth: '1px',
                  borderColor: '#e7e5e4',
                }}
              >
                <OrderSummary items={items} onRemoveItem={removeItem} />

                {/* Promotional Code Section */}
                <PromoCodeSection
                  promoCode={promoCode}
                  setPromoCode={setPromoCode}
                  appliedPromoCode={appliedPromoCode}
                  promoCodeType={promoCodeType}
                  promoCodeValue={promoCodeValue}
                  onApplyPromoCode={handleApplyPromoCode}
                  onRemovePromoCode={handleRemovePromoCode}
                  partnerCode={influencerCode}
                  setPartnerCode={setInfluencerCode}
                  activeReferral={activeReferral}
                  onApplyPartnerCode={handleApplyInfluencerCode}
                  onRemovePartnerCode={handleRemoveInfluencerCode}
                />

                <WalletCreditSection
                  availableCreditGBP={availableCreditGBP}
                  useWalletCredit={useWalletCredit}
                  setUseWalletCredit={handleWalletToggle}
                  appliedCredit={appliedCredit}
                  setAppliedCredit={setAppliedCredit}
                  maxApplicableCredit={maxApplicableCredit}
                />

                <PriceSummary
                  totalPrice={totalPrice}
                  discountAmount={discountAmount}
                  promoDiscount={promoDiscount}
                  promoCodeType={promoCodeType}
                  promoCodeValue={promoCodeValue}
                  appliedCredit={appliedCredit}
                  finalPrice={finalPrice}
                />
              </div>
            </div>

            {/* Payment Form - Right Column */}
            <div className="order-1 lg:order-2">
              {finalPrice > 0 && (
                <div
                  className="p-8 rounded-2xl shadow-sm"
                  style={{
                    backgroundColor: 'white',
                    borderWidth: '1px',
                    borderColor: '#e7e5e4',
                  }}
                >
                  <h2
                    className="text-xl font-bold mb-6"
                    style={{ color: '#151e20', fontFamily: "'Fraunces', serif" }}
                  >
                    Payment Details
                  </h2>

                  {/* Card Payment */}
                  <div className="mb-6">
                    <CardPayment
                      cardNumber={cardNumber}
                      setCardNumber={setCardNumber}
                      expiryDate={expiryDate}
                      setExpiryDate={setExpiryDate}
                      cvv={cvv}
                      setCvv={setCvv}
                      cardholderName={cardholderName}
                      setCardholderName={setCardholderName}
                    />

                    {/* Payment Error Display */}
                    {paymentError && (
                      <div className="mt-4 p-4 rounded-lg border" style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca' }}>
                        <div className="flex items-start">
                          <svg className="w-5 h-5 mr-2 shrink-0" style={{ color: '#dc2626' }} fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium" style={{ color: '#991b1b' }}>Payment Failed</p>
                            <p className="text-sm mt-1" style={{ color: '#dc2626' }}>{paymentError}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <ContactInformation
                    mobileNumber={mobileNumber}
                    setMobileNumber={setMobileNumber}
                    isMobileValid={isMobileValid}
                  />

                  <TermsCheckboxes
                    agreeTerms={agreeTerms}
                    setAgreeTerms={setAgreeTerms}
                    isUKResident={isUKResident}
                    setIsUKResident={setIsUKResident}
                    isOver18={isOver18}
                    setIsOver18={setIsOver18}
                    canProceed={canProceed}
                    isMobileValid={isMobileValid}
                    mobileNumber={mobileNumber}
                  />

                  <button
                    onClick={handlePayment}
                    disabled={loading || !canProceed}
                    className="w-full font-bold py-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-white text-lg"
                    style={{
                      backgroundColor: '#496B71',
                    }}
                    onMouseEnter={(e) => {
                      if (!loading && canProceed) {
                        e.currentTarget.style.backgroundColor = '#3a565a'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#496B71'
                    }}
                  >
                    {loading ? 'Processing...' : `Pay £${finalPrice.toFixed(2)}`}
                  </button>

                  <p className="text-xs text-center mt-4" style={{ color: '#78716c' }}>
                    Your payment is secure and encrypted
                  </p>
                </div>
              )}

              {finalPrice === 0 && (
                <div
                  className="p-8 rounded-2xl shadow-sm"
                  style={{
                    backgroundColor: 'white',
                    borderWidth: '1px',
                    borderColor: '#e7e5e4',
                  }}
                >
                  <h2
                    className="text-xl font-bold mb-6"
                    style={{ color: '#151e20', fontFamily: "'Fraunces', serif" }}
                  >
                    Complete Order
                  </h2>

                  <div
                    className="p-6 rounded-xl mb-6"
                    style={{
                      backgroundColor: '#ecfdf5',
                      borderWidth: '1px',
                      borderColor: '#a7f3d0',
                    }}
                  >
                    <p className="text-green-800 text-center font-medium">
                      Your order will be paid in full using wallet credit
                    </p>
                  </div>

                  <ContactInformation
                    mobileNumber={mobileNumber}
                    setMobileNumber={setMobileNumber}
                    isMobileValid={isMobileValid}
                  />

                  <TermsCheckboxes
                    agreeTerms={agreeTerms}
                    setAgreeTerms={setAgreeTerms}
                    isUKResident={isUKResident}
                    setIsUKResident={setIsUKResident}
                    isOver18={isOver18}
                    setIsOver18={setIsOver18}
                    canProceed={canProceed}
                    isMobileValid={isMobileValid}
                    mobileNumber={mobileNumber}
                  />

                  <button
                    onClick={handlePayment}
                    disabled={loading || !canProceed}
                    className="w-full font-bold py-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-white text-lg"
                    style={{
                      backgroundColor: '#496B71',
                    }}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        e.currentTarget.style.backgroundColor = '#3a565a'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#496B71'
                    }}
                  >
                    {loading ? 'Processing...' : 'Complete Order'}
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}

export default Checkout
