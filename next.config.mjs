/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.shopify.com' }, { protocol: 'https', hostname: 'cdn.shopify.com' }],
  },
  async headers() {
    // Shopify embeds the app inside the Admin iframe. Allow that ancestor only.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors https://*.myshopify.com https://admin.shopify.com;" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
