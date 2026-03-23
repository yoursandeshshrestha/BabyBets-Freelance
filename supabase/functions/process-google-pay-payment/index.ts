import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function createSignature(data: Record<string, string | number>, signatureKey: string): Promise<string> {
  const processedData: Record<string, string> = {}
  const keys = Object.keys(data).sort()
  keys.forEach(key => { processedData[key] = String(data[key]) })

  const params = new URLSearchParams()
  for (const key in processedData) {
    params.append(key, processedData[key])
  }
  let signatureString = params.toString()
  signatureString = signatureString
    .replace(/%0D%0A/g, '%0A')
    .replace(/%0A%0D/g, '%0A')
    .replace(/%0D/g, '%0A')

  const messageToHash = signatureString + signatureKey
  const msgBuffer = new TextEncoder().encode(messageToHash)
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const G2PAY_MERCHANT_ID = Deno.env.get('G2PAY_MERCHANT_ID')
    const G2PAY_SIGNATURE_KEY = Deno.env.get('G2PAY_SIGNATURE_KEY')
    const G2PAY_DIRECT_API_URL = Deno.env.get('G2PAY_DIRECT_API_URL') || 'https://payments.g2pay.co.uk/direct/'
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')

    if (!G2PAY_MERCHANT_ID || !G2PAY_SIGNATURE_KEY) {
      throw new Error('G2Pay configuration missing')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { orderId, paymentToken, customerEmail, customerPhone } = await req.json()

    if (!orderId || !paymentToken) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, user_id, status, total_pence')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (order.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (order.status === 'paid') {
      return new Response(JSON.stringify({ success: false, error: 'Order already paid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const transactionUnique = crypto.randomUUID()

    const { data: transactionLog } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        order_id: orderId,
        user_id: user.id,
        transaction_unique: transactionUnique,
        amount_pence: order.total_pence,
        currency_code: 826,
        status: 'pending',
        gateway_url: G2PAY_DIRECT_API_URL,
      })
      .select('id')
      .single()

    const requestData: Record<string, string | number> = {
      merchantID: G2PAY_MERCHANT_ID,
      action: 'SALE',
      type: 1,
      countryCode: 826,
      currencyCode: 826,
      amount: order.total_pence,
      orderRef: orderId,
      transactionUnique,
      paymentToken: typeof paymentToken === 'string' ? paymentToken : JSON.stringify(paymentToken),
      callbackURL: `${SUPABASE_URL}/functions/v1/g2pay-webhook`,
      ...(customerEmail && { customerEmail }),
      ...(customerPhone && { customerPhone }),
    }

    const signature = await createSignature(requestData, G2PAY_SIGNATURE_KEY)
    const finalRequest = { ...requestData, signature }

    const g2payResponse = await fetch(G2PAY_DIRECT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(finalRequest as Record<string, string>).toString(),
    })

    if (!g2payResponse.ok) {
      throw new Error(`G2Pay API request failed: ${g2payResponse.status}`)
    }

    const responseText = await g2payResponse.text()
    const responseParams = new URLSearchParams(responseText)
    const responseData: Record<string, string> = {}
    responseParams.forEach((value, key) => { responseData[key] = value })

    console.log('[Google Pay] G2Pay response:', {
      responseCode: responseData.responseCode,
      responseMessage: responseData.responseMessage,
    })

    if (responseData.responseCode === '0') {
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

      return new Response(JSON.stringify({
        success: true,
        transactionID: responseData.transactionID,
        transactionUnique: responseData.transactionUnique || transactionUnique,
        orderRef: responseData.orderRef || orderId,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

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

    return new Response(JSON.stringify({
      success: false,
      error: responseData.responseMessage || 'Payment failed',
      responseCode: responseData.responseCode,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('[Google Pay] Error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to process payment',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
