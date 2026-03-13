import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

// G2Pay Payment Gateway Configuration
export const G2PAY_CONFIG = {
  merchantId: import.meta.env.VITE_G2PAY_MERCHANT_ID,
  environment: import.meta.env.MODE === 'production' ? 'production' : 'sandbox',
  edgeFunctionUrl: import.meta.env.VITE_SUPABASE_URL + '/functions/v1',
}

// Card details interface
export interface CardDetails {
  cardNumber: string
  expiryMonth: string
  expiryYear: string
  cvv: string
  cardholderName: string
}

// Browser info for 3DS v2
export interface BrowserInfo {
  deviceChannel: string
  deviceIdentity: string
  deviceTimeZone: string
  deviceCapabilities: string
  deviceScreenResolution: string
  deviceAcceptContent?: string
  deviceAcceptEncoding?: string
  deviceAcceptLanguage?: string
}

// Hosted payment session response
interface HostedSessionResponse {
  success: boolean
  hostedPaymentURL?: string
  paymentFormData?: Record<string, string>
  orderRef?: string
  transactionUnique?: string
  requires3DS?: boolean
  threeDSURL?: string
  threeDSRequest?: Record<string, string>
  threeDSRef?: string
  threeDSVersion?: string
  error?: string
}

// Collect browser information for 3DS v2
export const collectBrowserInfo = (): BrowserInfo => {
  const screenWidth = window.screen ? window.screen.width : 0
  const screenHeight = window.screen ? window.screen.height : 0
  const screenDepth = window.screen ? window.screen.colorDepth : 0
  const timezone = new Date().getTimezoneOffset()
  const language = window.navigator.language || (window.navigator as { browserLanguage?: string }).browserLanguage || ''
  const javaEnabled = navigator.javaEnabled ? navigator.javaEnabled() : false

  return {
    deviceChannel: 'browser',
    deviceIdentity: window.navigator.userAgent || '',
    deviceTimeZone: timezone.toString(),
    deviceCapabilities: `javascript${javaEnabled ? ',java' : ''}`,
    deviceScreenResolution: `${screenWidth}x${screenHeight}x${screenDepth}`,
    deviceAcceptContent: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    deviceAcceptEncoding: 'gzip, deflate, br',
    deviceAcceptLanguage: language,
  }
}

// Create a hosted payment session via Edge Function
// Direct API: collect card details on our page
export const createHostedPaymentSession = async (
  orderRef: string,
  customerEmail?: string,
  customerPhone?: string,
  cardDetails?: CardDetails,
  browserInfo?: BrowserInfo
): Promise<HostedSessionResponse> => {
  // Get current session
  const {
    data: { session: currentSession },
    error: getSessionError
  } = await supabase.auth.getSession()

  if (getSessionError) {
    console.error('[G2Pay Hosted] Error getting session:', getSessionError)
    throw new Error('Failed to get authentication session')
  }

  if (!currentSession?.access_token) {
    console.error('[G2Pay Hosted] No valid session or access token')
    throw new Error('Not authenticated. Please log in.')
  }

  // Check if token is about to expire (within 5 minutes)
  const expiresAt = currentSession.expires_at
  const now = Math.floor(Date.now() / 1000)
  const timeUntilExpiry = expiresAt ? expiresAt - now : 0
  const shouldRefresh = expiresAt && timeUntilExpiry < 300

  // Refresh if needed
  if (shouldRefresh) {
    const {
      data: { session: refreshedSession },
      error: refreshError,
    } = await supabase.auth.refreshSession()

    if (refreshError) {
      console.error('[G2Pay Hosted] Session refresh error:', refreshError)
      throw new Error(`Session refresh failed: ${refreshError.message}. Please log in again.`)
    }

    if (!refreshedSession?.access_token) {
      console.error('[G2Pay Hosted] No valid session after refresh')
      throw new Error('Failed to refresh session. Please log in again.')
    }
  }

  // Get the latest session to ensure we have the most current JWT token
  const {
    data: { session: latestSession },
  } = await supabase.auth.getSession()

  if (!latestSession?.access_token) {
    throw new Error('No access token available. Please log in again.')
  }

  // Create a new Supabase client instance with the specific JWT token
  const supabaseWithAuth = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${latestSession.access_token}`,
        },
      },
    }
  )

  // Call Edge Function to create Direct API payment session
  const { data, error } = await supabaseWithAuth.functions.invoke('create-g2pay-hosted-session', {
    body: {
      orderRef,
      customerEmail,
      customerPhone,
      cardDetails,
      browserInfo,
    },
  })

  if (error) {
    console.error('[G2Pay Hosted] Edge function error:', error)
    console.error('[G2Pay Hosted] Error details:', {
      message: error.message,
      context: error.context,
      details: error
    })

    // Handle JWT-specific errors
    if (error.message?.includes('JWT') || error.message?.includes('401')) {
      throw new Error('Session expired. Please refresh the page and log in again.')
    }

    // Try to extract error from response body (when edge function returns 400 with error details)
    // The error context might contain the parsed JSON response
    if (error.context && typeof error.context === 'object') {
      const errorData = error.context as { error?: string; rawMessage?: string; responseCode?: string }
      console.log('[G2Pay Hosted] Error context data:', errorData)
      if (errorData.error) {
        throw new Error(errorData.error)
      }
      if (errorData.rawMessage) {
        throw new Error(errorData.rawMessage)
      }
    }

    // Try to parse error message as JSON (sometimes the error message contains the JSON response)
    try {
      const errorJson = JSON.parse(error.message)
      if (errorJson.error) {
        throw new Error(errorJson.error)
      }
    } catch (e) {
      // Not JSON, continue
    }

    throw new Error(error.message || 'Failed to create payment session')
  }

  // Check if the payment failed (edge function returned success: false in the data)
  // BUT allow success: false when requires3DS: true (that's not a failure, it's a redirect)
  if (data && !data.success && !data.requires3DS) {
    console.error('[G2Pay Hosted] Payment failed:', data)
    throw new Error(data.error || data.rawMessage || 'Payment failed')
  }

  return data
}

// Continue 3DS transaction after ACS challenge
export const continue3DSTransaction = async (
  orderRef: string,
  threeDSRef: string,
  threeDSResponse: Record<string, string>
): Promise<HostedSessionResponse> => {
  // Get current session
  const {
    data: { session: currentSession },
  } = await supabase.auth.getSession()

  if (!currentSession?.access_token) {
    throw new Error('Not authenticated. Please log in.')
  }

  // Create a new Supabase client instance with the JWT token
  const supabaseWithAuth = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
        },
      },
    }
  )

  // Call Edge Function to continue 3DS
  console.log('[G2Pay 3DS Continuation] Sending to edge function:', {
    orderRef,
    threeDSRef,
    threeDSResponse: JSON.stringify(threeDSResponse),
    keys: Object.keys(threeDSResponse),
  })

  const { data, error } = await supabaseWithAuth.functions.invoke('create-g2pay-hosted-session', {
    body: {
      orderRef,
      threeDSRef,
      threeDSResponse,
    },
  })

  if (error) {
    console.error('[G2Pay 3DS Continuation] Edge function error:', error)
    throw new Error(error.message || 'Failed to continue 3DS transaction')
  }

  if (data && !data.success) {
    console.error('[G2Pay 3DS Continuation] Payment failed:', data)
    throw new Error(data.error || 'Payment failed after 3DS')
  }

  return data
}
