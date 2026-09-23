/** Unguessable tokens for public links (quotes, bookings, unsubscribe). 32 url-safe characters ≈ 190 bits. */
export function randomToken(length = 32): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** A short stable id for JSON sub-items (sequence steps, form fields). */
export const shortId = () => randomToken(10);

/** 'Maya Brooks' → 'maya-brooks'. */
export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
