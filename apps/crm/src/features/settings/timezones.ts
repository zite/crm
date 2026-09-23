/**
 * The zones a B2B sales team actually works in. Not the full IANA list — a
 * six-hundred-item select is worse than a short one that covers everybody,
 * and any zone already stored on a record keeps working whether or not it is
 * here (the server validates against the real list).
 */
export const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Bogota',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Istanbul',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

/** Whatever the browser reports, so a zone a person already uses is never missing from the list. */
export function timezonesWith(...extra: Array<string | null | undefined>) {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([...TIMEZONES, local, ...extra].filter((x): x is string => Boolean(x)))].sort();
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
