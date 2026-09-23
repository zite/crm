/** Formatting shared by both apps and email copy. UI-only helpers live in each app's lib/format.ts. */

export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct 30, 2026' from a day or ISO string. */
export function longDay(day: string | null | undefined) {
  if (!day) return '';
  const d = String(day).slice(0, 10);
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
}

export function domainFromUrl(url: string | null | undefined) {
  if (!url) return '';
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function domainFromEmail(email: string | null | undefined) {
  const at = (email ?? '').lastIndexOf('@');
  return at > 0 ? (email as string).slice(at + 1).toLowerCase() : '';
}

/** A stable pigment index for a name, so a company mark never changes colour. */
export function hashIndex(seed: string, modulo: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % modulo;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
