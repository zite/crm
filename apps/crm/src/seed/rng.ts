/**
 * The sample data is generated from a fixed seed, so every load gets the same
 * organization and a screenshot taken today matches one taken tomorrow.
 * Never call Math.random() in the seed.
 */
export function makeRng(seed = 20260915) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];

export const pickWeighted = <T>(rng: Rng, list: ReadonlyArray<[T, number]>): T => {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [value, weight] of list) {
    r -= weight;
    if (r <= 0) return value;
  }
  return list[list.length - 1][0];
};

export const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

export const chance = (rng: Rng, p: number) => rng() < p;

export function sample<T>(rng: Rng, list: readonly T[], count: number): T[] {
  const copy = [...list];
  const out: T[] = [];
  while (out.length < Math.min(count, copy.length)) out.push(...copy.splice(Math.floor(rng() * copy.length), 1));
  return out;
}

/** A timestamp `daysAgo` days before now, at a plausible working hour. */
export function pastIso(rng: Rng, today: string, daysAgo: number, hour = 0) {
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - daysAgo);
  base.setUTCHours(hour || int(rng, 14, 23), int(rng, 0, 59), 0, 0); // 14–23 UTC ≈ 7am–4pm Pacific
  return base.toISOString();
}

export function futureIso(rng: Rng, today: string, daysAhead: number, hour = 0) {
  return pastIso(rng, today, -daysAhead, hour);
}

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
