'use client';

import { useState } from 'react';

export default function InstallForm({ configured }) {
  const [shop, setShop] = useState('');

  function install(event) {
    event.preventDefault();
    const cleaned = shop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const domain = cleaned.endsWith('.myshopify.com') ? cleaned : `${cleaned}.myshopify.com`;
    window.location.href = `/api/auth?shop=${encodeURIComponent(domain)}`;
  }

  return (
    <form onSubmit={install}>
      <label className="sp-label" htmlFor="shop">
        Install on your Shopify store
      </label>
      <div className="d-flex gap-2 flex-wrap">
        <input
          id="shop"
          className="sp-input"
          style={{ flex: '1 1 240px' }}
          placeholder="your-store.myshopify.com"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          required
        />
        <button className="sp-btn sp-btn-primary" type="submit" disabled={!configured}>
          Install
        </button>
      </div>
      {!configured && (
        <div className="sp-help" style={{ color: 'var(--sp-warning)' }}>
          Shopify credentials are not configured on this deployment. Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET.
        </div>
      )}
    </form>
  );
}
