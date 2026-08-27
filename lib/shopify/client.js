import { env } from '@/lib/env';
import { ensureFreshToken } from '@/lib/shopify/token';

export class ShopifyApiError extends Error {
  constructor(message, { status, errors, userErrors } = {}) {
    super(message);
    this.name = 'ShopifyApiError';
    this.status = status;
    this.errors = errors;
    this.userErrors = userErrors;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a GraphQL request against the Shopify Admin API.
 * Handles throttling (429 / THROTTLED) with bounded exponential backoff.
 */
export async function shopifyGraphQL(store, query, variables = {}, { retries = 3 } = {}) {
  const url = `https://${store.shopDomain}/admin/api/${env.apiVersion}/graphql.json`;

  // Access tokens live one hour, so refresh before use rather than waiting for
  // a 401. Demo stores never talk to Shopify.
  let active = await ensureFreshToken(store);
  let refreshedOnce = false;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': active.accessToken,
        },
        body: JSON.stringify({ query, variables }),
        cache: 'no-store',
      });
    } catch (networkError) {
      if (attempt === retries) throw new ShopifyApiError(`Network error calling Shopify: ${networkError.message}`);
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt === retries) {
        throw new ShopifyApiError(`Shopify API unavailable (${res.status})`, { status: res.status });
      }
      const retryAfter = Number(res.headers.get('Retry-After')) || 2 ** attempt;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      // A token can be revoked mid-flight; try exactly one forced refresh
      // before concluding the connection is genuinely broken.
      if (!refreshedOnce) {
        refreshedOnce = true;
        active = await ensureFreshToken(active, { force: true });
        continue;
      }
      throw new ShopifyApiError('Shopify rejected the access token. The app may need to be reinstalled.', {
        status: res.status,
      });
    }

    const json = await res.json().catch(() => null);
    if (!json) throw new ShopifyApiError('Shopify returned an unreadable response', { status: res.status });

    if (json.errors?.length) {
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < retries) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw new ShopifyApiError(json.errors.map((e) => e.message).join('; '), { errors: json.errors });
    }

    return json.data;
  }

  throw new ShopifyApiError('Shopify request exhausted retries');
}

/**
 * Walk a Relay-style connection until `max` nodes are collected.
 * `pick` receives the GraphQL data and returns the connection object.
 */
export async function paginate(store, query, variables, pick, { max = 1000, pageSize = 100 } = {}) {
  const nodes = [];
  let cursor = null;

  while (nodes.length < max) {
    const data = await shopifyGraphQL(store, query, {
      ...variables,
      first: Math.min(pageSize, max - nodes.length),
      after: cursor,
    });
    const connection = pick(data);
    if (!connection) break;
    nodes.push(...connection.nodes);
    if (!connection.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return nodes;
}
