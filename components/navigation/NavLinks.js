'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Kept to routes that exist. Activity, Audience and Plan arrive with the phases
// that give them something to show — a nav entry leading to an empty page is
// worse than no nav entry.
export const NAV_ITEMS = [
  { href: '/workflows', label: 'Automations', icon: '⚡' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

// Everything up to Settings is the product; the rest is account.
const PRODUCT_COUNT = NAV_ITEMS.findIndex((i) => i.href === '/settings');

const MOBILE_ITEMS = NAV_ITEMS;

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Item({ item, pathname }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={`sp-nav-item${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="sp-nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="sp-nav" aria-label="Main">
      <div className="sp-nav-label">Automations</div>
      {NAV_ITEMS.slice(0, PRODUCT_COUNT).map((item) => (
        <Item key={item.href} item={item} pathname={pathname} />
      ))}

      <div className="sp-nav-label">Account</div>
      {NAV_ITEMS.slice(PRODUCT_COUNT).map((item) => (
        <Item key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="sp-mobile-nav" aria-label="Main (mobile)">
      {MOBILE_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? 'active' : ''}>
          <span className="ico" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
