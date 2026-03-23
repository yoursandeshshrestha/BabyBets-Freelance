/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_G2PAY_MERCHANT_ID: string
  readonly VITE_GOOGLE_MERCHANT_ID: string
  readonly VITE_GOOGLE_PAY_MERCHANT_NAME: string
  readonly VITE_GOOGLE_PAY_GATEWAY: string
  readonly VITE_GOOGLE_PAY_GATEWAY_MERCHANT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Apple Pay API declarations
interface ApplePayPaymentRequest {
  countryCode: string
  currencyCode: string
  supportedNetworks: string[]
  merchantCapabilities: string[]
  total: {
    label: string
    amount: string
    type: string
  }
}

interface ApplePayPaymentToken {
  paymentData: string
}

interface ApplePayPayment {
  token: ApplePayPaymentToken
}

interface ApplePayValidateMerchantEvent {
  validationURL: string
}

interface ApplePayPaymentAuthorizedEvent {
  payment: ApplePayPayment
}

interface ApplePaySession {
  onvalidatemerchant: ((event: ApplePayValidateMerchantEvent) => void) | null
  onpaymentauthorized: ((event: ApplePayPaymentAuthorizedEvent) => void) | null
  oncancel: (() => void) | null
  completeMerchantValidation(merchantSession: unknown): void
  completePayment(result: { status: number }): void
  abort(): void
  begin(): void
}

interface ApplePaySessionConstructor {
  new (version: number, paymentRequest: ApplePayPaymentRequest): ApplePaySession
  canMakePayments(): boolean
  STATUS_SUCCESS: number
  STATUS_FAILURE: number
}

interface Window {
  ApplePaySession?: ApplePaySessionConstructor
  google?: {
    payments: {
      api: {
        PaymentsClient: new (config: { environment: string }) => any
      }
    }
  }
  PaymentRequest?: {
    new (
      methodData: unknown[],
      details: unknown,
      options?: unknown
    ): {
      canMakePayment(): Promise<boolean>
      show(): Promise<unknown>
    }
  }
}
