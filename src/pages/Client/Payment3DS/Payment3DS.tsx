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

  const orderRef = searchParams.get('orderRef')
  const threeDSURL = searchParams.get('threeDSURL')
  const threeDSRef = searchParams.get('threeDSRef')

  useEffect(() => {
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

    const threeDSRequest = JSON.parse(threeDSRequestStr)

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

    // Submit the form after iframe loads
    if (iframeRef.current) {
      iframeRef.current.onload = () => {
        form.submit()
      }
    }

    // Listen for messages from the iframe (3DS response)
    const handleMessage = async (event: MessageEvent) => {
      // Only accept messages from the iframe
      if (event.origin !== new URL(threeDSURL).origin) {
        return
      }

      console.log('[Payment3DS] Received message from ACS:', event.data)

      // The ACS will post back the response
      if (event.data && typeof event.data === 'object') {
        setLoading(true)

        try {
          // Continue the transaction with the 3DS response
          const result = await continue3DSTransaction(threeDSRef, event.data)

          if (result.success) {
            // Payment successful
            localStorage.removeItem('pendingOrderId')
            localStorage.removeItem('threeDSRef')
            localStorage.removeItem('threeDSRequest')
            navigate('/account?tab=tickets&purchase=success')
          } else {
            throw new Error(result.error || 'Payment failed after 3DS')
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
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
      document.body.removeChild(form)
    }
  }, [orderRef, threeDSURL, threeDSRef, navigate])

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
              Please complete the additional security verification to proceed with your payment.
            </p>

            {loading && (
              <div className="text-center mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: '#496B71' }}></div>
                <p className="text-gray-600 mt-2">Processing your payment...</p>
              </div>
            )}

            {/* 3DS Challenge iframe */}
            <div className="border rounded-lg overflow-hidden" style={{ height: '450px' }}>
              <iframe
                ref={iframeRef}
                name="threeds_acs"
                title="3D Secure Authentication"
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            </div>

            <div className="mt-6 text-center text-sm text-gray-500">
              <p>🔒 This is a secure payment verification process</p>
              <p className="mt-2">You may be asked to verify your identity with your bank</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Payment3DS
