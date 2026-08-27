/**
 * Placeholder substitution for message bodies.
 *
 * Deliberately tiny and deliberately not a template language. A merchant's
 * email body is written by them or compiled from their sentence; giving it
 * loops, conditionals or property access would mean arbitrary expressions
 * evaluated against customer data on the send path, and a mistake there is a
 * mistake a customer reads.
 *
 * An unknown placeholder is left alone rather than replaced with an empty
 * string. "Here is {{discout_code}}" is a typo someone can see and fix; "Here
 * is " is a mystery.
 *
 * A placeholder with no value is a different case: the message would read as
 * broken either way, so the caller is told and can skip the send.
 */

const PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export const KNOWN_PLACEHOLDERS = ['discount_code', 'customer_name', 'store_name'];

export function renderBody(text, values) {
  const missing = [];

  const rendered = String(text ?? '').replace(PATTERN, (match, key) => {
    if (!KNOWN_PLACEHOLDERS.includes(key)) return match;

    const value = values[key];
    if (value === undefined || value === null || value === '') {
      missing.push(key);
      return match;
    }
    return String(value);
  });

  return { text: rendered, missing };
}

/** Which known placeholders a body actually uses. */
export function placeholdersUsed(text) {
  const found = new Set();
  for (const [, key] of String(text ?? '').matchAll(PATTERN)) {
    if (KNOWN_PLACEHOLDERS.includes(key)) found.add(key);
  }
  return [...found];
}
