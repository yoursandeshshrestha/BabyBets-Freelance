import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
}

// PHP-compatible URL encoding to match http_build_query()
function phpRawUrlEncode(str: string): string {
  // PHP's rawurlencode() encodes according to RFC 3986
  // It encodes everything except: A-Z a-z 0-9 - _ . ~
  // Then we convert spaces to + for application/x-www-form-urlencoded
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '+') // Spaces as + for application/x-www-form-urlencoded
}

// Generate signature using G2Pay's method (SHA-512)
async function createSignature(data: Record<string, string | number>, signatureKey: string): Promise<string> {
  // Sort keys alphabetically (same as PHP's ksort)
  const keys = Object.keys(data).sort()

  // Build query string to match PHP's http_build_query() encoding EXACTLY
  const pairs: string[] = []
  keys.forEach(key => {
    const value = String(data[key])
    const encodedKey = phpRawUrlEncode(key)
    const encodedValue = phpRawUrlEncode(value)
    pairs.push(`${encodedKey}=${encodedValue}`)
  })

  let signatureString = pairs.join('&')

  // Normalise all line endings (CRNL|NLCR|NL|CR) to just NL (%0A)
  signatureString = signatureString
    .replace(/%0D%0A/g, '%0A')
    .replace(/%0A%0D/g, '%0A')
    .replace(/%0D/g, '%0A')

  // Log the query string (first 200 chars) for debugging
  console.log('[createSignature] Query string (first 200 chars):', signatureString.substring(0, 200))
  console.log('[createSignature] Query string length:', signatureString.length)

  const messageToHash = signatureString + signatureKey

  // Log the complete string being hashed (for G2Pay support verification)
  console.log('[createSignature] String to hash (first 250 chars):', messageToHash.substring(0, 250))
  console.log('[createSignature] String to hash (last 50 chars):', messageToHash.substring(messageToHash.length - 50))
  console.log('[createSignature] Total length with key:', messageToHash.length)

  const msgBuffer = new TextEncoder().encode(messageToHash)
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  return hashHex
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get environment variables
    const G2PAY_MERCHANT_ID = Deno.env.get('G2PAY_MERCHANT_ID')
    const G2PAY_SIGNATURE_KEY = Deno.env.get('G2PAY_SIGNATURE_KEY')
    const G2PAY_DIRECT_API_URL = Deno.env.get('G2PAY_DIRECT_API_URL') || 'https://payments.g2pay.co.uk'
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SITE_URL = Deno.env.get('SITE_URL') || Deno.env.get('PUBLIC_SITE_URL')

    if (!G2PAY_MERCHANT_ID || !G2PAY_SIGNATURE_KEY || !G2PAY_DIRECT_API_URL || !SITE_URL) {
      throw new Error('G2Pay configuration missing: G2PAY_MERCHANT_ID, G2PAY_SIGNATURE_KEY, G2PAY_DIRECT_API_URL, and SITE_URL are required')
    }

    // Verify JWT token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Missing token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Verify JWT using anon client
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Invalid token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Create service role client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Get request body (includes card details and browser info for Direct API with 3DS)
    const {
      orderRef,
      customerEmail,
      customerPhone,
      cardDetails,
      browserInfo,
      threeDSRef,
      threeDSResponse,
    } = await req.json()

    if (!orderRef) {
      return new Response(JSON.stringify({ error: 'orderRef is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Clean phone number - remove spaces for G2Pay
    const cleanedPhone = customerPhone ? customerPhone.replace(/\s/g, '') : undefined

    // Security: Verify the order exists and belongs to the authenticated user
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, user_id, status, total_pence')
      .eq('id', orderRef)
      .single()

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Security: Ensure authenticated user owns this order
    if (order.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Order does not belong to user' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Idempotency: Check if order is already paid
    if (order.status === 'paid') {
      return new Response(
        JSON.stringify({ success: false, error: 'Order already paid' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Generate unique transaction ID
    const transactionUnique = crypto.randomUUID()

    // Log transaction attempt
    const { data: transactionLog, error: logError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        order_id: orderRef,
        user_id: user.id,
        transaction_unique: transactionUnique,
        amount_pence: order.total_pence,
        currency_code: 826, // GBP
        status: 'pending',
        gateway_url: G2PAY_DIRECT_API_URL,
      })
      .select('id')
      .single()

    if (logError) {
      console.error('[create-g2pay-hosted-session] Failed to create transaction log:', logError)
    }

    // Check if this is a 3DS continuation request
    if (threeDSRef) {
      // This is a 3DS continuation - continuing after method or challenge
      console.log('[create-g2pay-direct] Processing 3DS continuation')
      console.log('[create-g2pay-direct] threeDSResponse type:', typeof threeDSResponse, 'keys:', threeDSResponse ? Object.keys(threeDSResponse) : 'null')

      const continuationData: Record<string, string | number> = {
        threeDSRef,
      }

      // Check if threeDSResponse is provided and has data
      let hasResponseData = false
      if (threeDSResponse) {
        if (typeof threeDSResponse === 'string') {
          // String response (e.g., "method")
          continuationData.threeDSResponse = threeDSResponse
          hasResponseData = true
        } else if (typeof threeDSResponse === 'object' && Object.keys(threeDSResponse).length > 0) {
          // Object with POST data from ACS
          console.log('[create-g2pay-direct] Including ACS POST data')
          Object.entries(threeDSResponse).forEach(([key, value]) => {
            continuationData[key] = String(value)
          })
          hasResponseData = true
        }
      }

      console.log('[create-g2pay-direct] Continuation data keys:', Object.keys(continuationData).join(', '))

      const signature = await createSignature(continuationData, G2PAY_SIGNATURE_KEY)

      // Build final request
      const finalRequest: Record<string, string> = {
        ...continuationData as Record<string, string>,
        signature,
      }

      // Make the continuation request
      const g2payResponse = await fetch(G2PAY_DIRECT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(finalRequest as Record<string, string>).toString(),
      })

      const responseText = await g2payResponse.text()
      console.log('[create-g2pay-direct] 3DS continuation response:', responseText)

      const responseParams = new URLSearchParams(responseText)
      const responseData: Record<string, string> = {}
      responseParams.forEach((value, key) => {
        responseData[key] = value
      })

      // Handle the response (success or failure)
      if (responseData.responseCode === '0') {
        console.log('[create-g2pay-direct] ✅ Payment successful after 3DS')

        return new Response(
          JSON.stringify({
            success: true,
            transactionID: responseData.transactionID,
            message: responseData.responseMessage,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      } else {
        console.error('[create-g2pay-direct] Payment failed after 3DS:', responseData.responseMessage)

        return new Response(
          JSON.stringify({
            success: false,
            error: responseData.responseMessage || 'Payment failed',
            responseCode: responseData.responseCode,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
    }

    // Validate card details are provided
    if (!cardDetails || !cardDetails.cardNumber || !cardDetails.expiryMonth || !cardDetails.expiryYear || !cardDetails.cvv) {
      return new Response(
        JSON.stringify({ error: 'Card details are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Get client IP address for 3DS
    const deviceIpAddress = req.headers.get('x-forwarded-for')?.split(',')[0] ||
                           req.headers.get('x-real-ip') ||
                           'unknown'

    // Prepare request data for G2Pay Direct API with 3DS support
    // Following PHP example exactly - NO transactionUnique, NO callbackURL
    const requestData: Record<string, string | number> = {
      merchantID: G2PAY_MERCHANT_ID,
      action: 'SALE',
      type: 1,
      countryCode: 826, // UK
      currencyCode: 826, // GBP
      amount: order.total_pence,
      orderRef,
      // NOTE: transactionUnique removed - not in PHP example, tracked in our DB instead

      // Card details
      cardNumber: cardDetails.cardNumber,
      cardExpiryMonth: cardDetails.expiryMonth,
      cardExpiryYear: cardDetails.expiryYear,
      cardCVV: cardDetails.cvv,

      // 3DS required fields
      deviceIpAddress,
      threeDSRedirectURL: `${SITE_URL}/payment-3ds?orderRef=${orderRef}&acs=1`,

      // NOTE: callbackURL removed - not in PHP example, may be pre-configured in G2Pay portal

      // Optional customer details
      ...(customerEmail && { customerEmail }),
      ...(cleanedPhone && { customerPhone: cleanedPhone }),
      ...(cardDetails.cardholderName && { customerName: cardDetails.cardholderName }),

      // Browser info for 3DS v2 (if provided)
      ...(browserInfo && browserInfo),
    }

    console.log('[create-g2pay-direct] Processing Direct API payment:', {
      orderRef,
      amount: order.total_pence,
      transactionUnique, // Tracked in DB only, not sent to G2Pay
      apiUrl: G2PAY_DIRECT_API_URL,
    })

    console.log('[create-g2pay-direct] Request data (card hidden):', {
      ...requestData,
      cardNumber: '****',
      cardCVV: '***',
    })

    // Log sorted keys for debugging
    const sortedKeys = Object.keys(requestData).sort()
    console.log('[create-g2pay-direct] Sorted keys:', sortedKeys.join(', '))
    console.log('[create-g2pay-direct] Signature key length:', G2PAY_SIGNATURE_KEY?.length, 'Expected: 13')

    // For Direct Integration with 3DS, sign ALL fields in the request
    // We removed transactionUnique and callbackURL entirely to match PHP example
    const signatureData = { ...requestData }

    console.log('[create-g2pay-direct] Signature fields (all request fields):', Object.keys(signatureData).sort().join(', '))

    // Generate signature
    const signature = await createSignature(signatureData, G2PAY_SIGNATURE_KEY)
    console.log('[create-g2pay-direct] Generated signature:', signature)

    // Add signature to request
    const finalRequest = {
      ...requestData,
      signature,
    }

    // Make direct POST request to G2Pay API
    const g2payResponse = await fetch(G2PAY_DIRECT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(finalRequest as Record<string, string>).toString(),
    })

    if (!g2payResponse.ok) {
      console.error('[create-g2pay-direct] G2Pay API request failed:', g2payResponse.status)
      throw new Error(`G2Pay API request failed: ${g2payResponse.status}`)
    }

    // Parse response
    const responseText = await g2payResponse.text()
    console.log('[create-g2pay-direct] Raw G2Pay response:', responseText)

    const responseParams = new URLSearchParams(responseText)
    const responseData: Record<string, string> = {}
    const threeDSRequest: Record<string, string> = {}
    const threeDSDetails: Record<string, string> = {}

    responseParams.forEach((value, key) => {
      // Handle nested parameters like threeDSRequest[threeDSMethodData]
      if (key.startsWith('threeDSRequest[')) {
        const subKey = key.match(/\[([^\]]+)\]/)?.[1]
        if (subKey) {
          threeDSRequest[subKey] = value
        }
      } else if (key.startsWith('threeDSDetails[')) {
        const subKey = key.match(/\[([^\]]+)\]/)?.[1]
        if (subKey) {
          threeDSDetails[subKey] = value
        }
      } else {
        responseData[key] = value
      }
    })

    console.log('[create-g2pay-direct] Parsed response:', {
      responseCode: responseData.responseCode,
      responseMessage: responseData.responseMessage,
      transactionID: responseData.transactionID,
    })

    // Check if 3DS challenge is required (responseCode 65802)
    if (responseData.responseCode === '65802') {
      console.log('[create-g2pay-direct] 3DS challenge required')
      console.log('[create-g2pay-direct] 3DS URL:', responseData.threeDSURL)
      console.log('[create-g2pay-direct] 3DS Request:', threeDSRequest)

      return new Response(
        JSON.stringify({
          success: false,
          requires3DS: true,
          threeDSURL: responseData.threeDSURL,
          threeDSRequest: threeDSRequest, // Already an object
          threeDSDetails: threeDSDetails,
          threeDSRef: responseData.threeDSRef,
          threeDSVersion: responseData.threeDSVersion,
          orderRef,
          transactionID: responseData.transactionID,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Check payment status (responseCode '0' = success)
    if (responseData.responseCode === '0') {
      console.log('[create-g2pay-direct] ✅ Payment successful')

      // Update transaction log with success
      if (transactionLog?.id) {
        await supabaseAdmin
          .from('payment_transactions')
          .update({
            transaction_id: responseData.transactionID,
            response_code: responseData.responseCode,
            response_message: responseData.responseMessage,
            status: 'success',
            response_data: responseData,
          })
          .eq('id', transactionLog.id)
      }

      return new Response(
        JSON.stringify({
          success: true,
          transactionID: responseData.transactionID,
          transactionUnique: responseData.transactionUnique || transactionUnique,
          orderRef: responseData.orderRef || orderRef,
          message: responseData.responseMessage,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Payment failed
    console.error('[create-g2pay-direct] Payment failed:', {
      responseCode: responseData.responseCode,
      responseMessage: responseData.responseMessage,
    })

    // Update transaction log with failure
    if (transactionLog?.id) {
      await supabaseAdmin
        .from('payment_transactions')
        .update({
          response_code: responseData.responseCode,
          response_message: responseData.responseMessage,
          status: 'failed',
          response_data: responseData,
          error_message: responseData.responseMessage,
        })
        .eq('id', transactionLog.id)
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: responseData.responseMessage || 'Payment failed',
        responseCode: responseData.responseCode,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('[create-g2pay-hosted-session] Error:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to create payment session',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
