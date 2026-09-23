const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(day: string | null | undefined) {
  if (!day) return '';
  const d = new Date(`${String(day).slice(0, 10)}T00:00:00`);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function dateTime(iso: string | null | undefined, timezone?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined, timeZoneName: 'short' });
}

export function money(value: number | null | undefined, currency = 'USD', opts: { cents?: boolean } = {}) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: opts.cents === false ? 0 : 2, maximumFractionDigits: opts.cents === false ? 0 : 2 }).format(value ?? 0);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
