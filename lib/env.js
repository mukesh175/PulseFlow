// Central place for reading configuration. Nothing here is exposed to the
// browser — every consumer runs on the server.

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get shopifyApiKey() {
    return required('SHOPIFY_API_KEY');
  },
  get shopifyApiSecret() {
    return required('SHOPIFY_API_SECRET');
  },
  get appUrl() {
    return required('SHOPIFY_APP_URL').replace(/\/$/, '');
  },
  /// PulseFlow sends messages and creates discounts, so it asks for write
  /// scopes StorePulse deliberately never had. `read_customers` carries the
  /// marketing-consent field the send path checks.
  get scopes() {
    return required(
      'SHOPIFY_SCOPES',
      'read_orders,read_products,read_customers,write_discounts,read_discounts'
    );
  },
  get apiVersion() {
    return process.env.SHOPIFY_API_VERSION || '2026-07';
  },
  get sessionSecret() {
    return required('APP_SESSION_SECRET', process.env.SHOPIFY_API_SECRET);
  },
  get cronSecret() {
    return required('CRON_SECRET');
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY || '';
  },
  /// Fallback sending identity, used until a merchant verifies their own
  /// domain. Shared across stores, so its reputation is shared too.
  get resendFrom() {
    return process.env.RESEND_FROM_EMAIL || 'PulseFlow <onboarding@resend.dev>';
  },
};

export function isConfigured() {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET && process.env.DATABASE_URL);
}
