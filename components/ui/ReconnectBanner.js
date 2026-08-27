/**
 * Shown when the store's Shopify credentials can no longer be refreshed.
 *
 * The link must open in the top window: Shopify's OAuth screen refuses to
 * render inside the admin iframe, so target="_top" is what makes this button
 * work at all from an embedded page.
 */
export default function ReconnectBanner({ shopDomain }) {
  const url = `/api/auth?shop=${encodeURIComponent(shopDomain)}`;

  return (
    <div className="sp-banner critical mb-3">
      <span aria-hidden="true">🔌</span>
      <div className="flex-grow-1">
        <strong>Reconnect PulseFlow to Shopify</strong>
        <div className="mt-1">
          Shopify no longer accepts the credentials this store was connected with, so syncing and alerts are
          paused. Reconnecting takes a few seconds and does not affect your settings, alert history or data.
        </div>
        <a className="sp-btn sp-btn-sm sp-btn-primary mt-2" href={url} target="_top" rel="noreferrer">
          Reconnect to Shopify
        </a>
      </div>
    </div>
  );
}
