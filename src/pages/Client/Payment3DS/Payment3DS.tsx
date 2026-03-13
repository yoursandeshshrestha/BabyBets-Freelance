import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Header from '@/components/common/Header'
import { continue3DSTransaction } from '@/lib/g2pay'
import { showErrorToast } from '@/lib/toast'

function Payment3DS() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showIframe, setShowIframe] = useState(true)

  const orderRef = searchParams.get('orderRef')
  const threeDSURL = searchParams.get('threeDSURL')
  const threeDSRef = searchParams.get('threeDSRef')
  const threeDSAcsResponse = searchParams.get('threeDSAcsResponse')
  const isAcsCallback = searchParams.get('acs') === '1'

  useEffect(() => {
    // If this is an ACS callback from iframe (method completed)
    if (isAcsCallback && threeDSAcsResponse === 'method') {
      console.log('[Payment3DS] Method callback detected in iframe - notifying parent')
      if (window.parent !== window && orderRef) {
        window.parent.postMessage({ type: 'ACS_METHOD_COMPLETE', orderRef }, '*')
      }
      return
    }

    // If this is a direct ACS response in parent window
    if (threeDSAcsResponse && threeDSRef && !isAcsCallback) {
      console.log('[Payment3DS] Processing direct ACS response:', threeDSAcsResponse)
      processACSResponse(threeDSAcsResponse, threeDSRef)
      return
    }

    if (!orderRef || !threeDSURL || !threeDSRef) {
      setError('Missing 3DS parameters')
      return
    }

    // Get 3DS request data from localStorage
    const threeDSRequestStr = localStorage.getItem('threeDSRequest')
    if (!threeDSRequestStr) {
      setError('Missing 3DS request data')
      return
    }

    try {
      const threeDSRequest = JSON.parse(threeDSRequestStr)
      console.log('[Payment3DS] Initiating 3DS challenge with data:', threeDSRequest)

      // Create a hidden form and submit it to the ACS URL in the iframe
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = threeDSURL
      form.target = 'threeds_acs'
      form.style.display = 'none'

      // Add all fields from threeDSRequest
      Object.entries(threeDSRequest).forEach(([key, value]) => {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = key
        input.value = String(value)
        form.appendChild(input)
      })

      document.body.appendChild(form)

      // Submit the form after a short delay to ensure iframe is ready
      setTimeout(() => {
        console.log('[Payment3DS] Submitting 3DS method form to ACS')
        form.submit()

        // Listen for message from iframe when method completes
        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === 'ACS_METHOD_COMPLETE' && event.data?.orderRef === orderRef) {
            console.log('[Payment3DS] Received method completion from iframe - continuing transaction')
            if (threeDSRef) {
              // Continue transaction with method indicator
              processACSResponse('method', threeDSRef)
            }
          }
        }

        window.addEventListener('message', handleMessage)

        // Fallback: if no message received after 10 seconds, continue anyway
        const fallbackTimeout = setTimeout(() => {
          console.log('[Payment3DS] Timeout - no callback from ACS, continuing anyway...')
          if (threeDSRef) {
            processACSResponse('method', threeDSRef)
          }
        }, 10000)

        return () => {
          window.removeEventListener('message', handleMessage)
          clearTimeout(fallbackTimeout)
          if (document.body.contains(form)) {
            document.body.removeChild(form)
          }
        }
      }, 100)

      return () => {
        if (document.body.contains(form)) {
          document.body.removeChild(form)
        }
      }
    } catch (err) {
      console.error('[Payment3DS] Error setting up 3DS challenge:', err)
      setError('Failed to initialize 3DS challenge')
    }
  }, [orderRef, threeDSURL, threeDSRef, isAcsCallback])

  const processACSResponse = async (acsResponse: string, ref: string) => {
    setLoading(true)
    setShowIframe(false)

    if (!orderRef) {
      setError('Missing order reference')
      setLoading(false)
      return
    }

    try {
      console.log('[Payment3DS] Continuing transaction with 3DS response')

      // Parse the ACS response
      const responseData: Record<string, string> = {}
      if (acsResponse) {
        // If it's a query string, parse it
        try {
          const params = new URLSearchParams(acsResponse)
          params.forEach((value, key) => {
            responseData[key] = value
          })
        } catch {
          // If not a query string, just pass it as-is
          responseData.threeDSResponse = acsResponse
        }
      }

      const result = await continue3DSTransaction(orderRef, ref, responseData)

      if (result.success) {
        console.log('[Payment3DS] ✅ Payment successful after 3DS')
        // Payment successful
        localStorage.removeItem('pendingOrderId')
        localStorage.removeItem('threeDSRef')
        localStorage.removeItem('threeDSRequest')
        navigate('/account?tab=tickets&purchase=success')
      } else {
        throw new Error(result.error || 'Payment failed after 3DS authentication')
      }
    } catch (err) {
      console.error('[Payment3DS] Error continuing transaction:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to complete payment'
      setError(errorMessage)
      showErrorToast(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#FFFCF9', color: '#2D251E' }}>
        <Header />
        <div className="flex items-center justify-center pt-24 pb-16 px-6">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="mb-4">
              <svg className="mx-auto h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-4">Payment Error</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => navigate('/checkout')}
              className="px-6 py-3 rounded-lg font-medium cursor-pointer"
              style={{ backgroundColor: '#496B71', color: 'white' }}
            >
              Return to Checkout
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FFFCF9', color: '#2D251E' }}>
      <Header />
      <div className="pt-24 pb-16 px-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-4 text-center">Secure Payment Verification</h2>
            <p className="text-gray-600 mb-6 text-center">
              {loading ? 'Processing your payment...' : 'Verifying your payment with your bank...'}
            </p>

            {loading && (
              <div className="text-center mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: '#496B71' }}></div>
                <p className="text-gray-600 mt-2">Processing your payment...</p>
              </div>
            )}

            {/* 3DS Challenge iframe */}
            {showIframe && (
              <div className="border rounded-lg overflow-hidden" style={{ height: '450px' }}>
                <iframe
                  ref={iframeRef}
                  name="threeds_acs"
                  title="3D Secure Authentication"
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              </div>
            )}


            {!loading && (
              <div className="mt-6 text-center text-sm text-gray-500">
                <p>🔒 This is a secure payment verification process</p>
                <p className="mt-2">Verifying your card security in the background...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Payment3DS
