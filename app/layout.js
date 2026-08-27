import 'bootstrap/dist/css/bootstrap.min.css';
import './globals.css';

export const metadata = {
  title: 'PulseFlow — Describe an automation. Watch it run.',
  description:
    'PulseFlow turns a sentence into a Shopify automation you can read, edit and approve before a single message goes out.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3d5afe',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/*
          Shopify requires App Bridge to be the first script in <head>, loaded
          from their CDN with the API key. A plain tag is used rather than
          next/script so nothing can defer or reorder it.
        */}
        {process.env.SHOPIFY_API_KEY && (
          <>
            {/*
              App Bridge reads the client ID from this meta tag, which must
              precede the script. The data-api-key attribute is the older
              form — both are set so either resolution path works.
            */}
            <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY} />
            {/* eslint-disable-next-line @next/next/no-sync-scripts -- Shopify requires App Bridge first in <head>, loaded synchronously */}
            <script
              src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
              data-api-key={process.env.SHOPIFY_API_KEY}
            />
          </>
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
