/**
 * Lead fit score, 0–100, from what a lead tells us about themselves. Simple and
 * explainable on purpose: every point has a reason a rep can read
 * (`scoreLead(...).reasons`), and nobody has to trust a black box.
 */

export type LeadFit = { employees?: number | null; title?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; source?: string | null; message?: string | null };

const FREE_MAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|aol|icloud|me|proton|protonmail|gmx|yandex|mail)\./i;

export function scoreLead(l: LeadFit): { score: number; rating: 'Hot' | 'Warm' | 'Cold'; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`);
  };
  const emp = Number(l.employees) || 0;
  if (emp >= 1000) add(30, '1,000+ employees');
  else if (emp >= 200) add(24, '200–999 employees');
  else if (emp >= 50) add(16, '50–199 employees');
  else if (emp > 0) add(6, 'under 50 employees');

  const title = (l.title ?? '').toLowerCase();
  if (/\b(chief|ceo|cfo|coo|cto|cio|cro|founder|owner|president|partner)\b|\bvp\b|vice president/.test(title)) add(25, 'executive title');
  else if (/\b(head|director)\b/.test(title)) add(20, 'director-level title');
  else if (/\bmanager|lead\b/.test(title)) add(12, 'manager title');
  else if (title) add(4, 'title given');

  if (l.email && !FREE_MAIL.test(l.email)) add(10, 'work email');
  else if (l.email) add(-5, 'personal email');
  if (l.phone) add(5, 'phone number');
  if (l.companyName) add(5, 'company named');

  const source = (l.source ?? '').toLowerCase();
  if (/demo|pricing|contact sales/.test(source)) add(20, 'asked for a demo');
  else if (/referral|partner/.test(source)) add(18, 'referral');
  else if (/event|webinar|conference/.test(source)) add(8, 'met at an event');
  else if (/website|form|inbound|organic/.test(source)) add(8, 'came in through the website');

  if ((l.message ?? '').trim().length > 80) add(5, 'wrote a detailed message');

  score = Math.max(0, Math.min(100, score));
  return { score, rating: score >= 65 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold', reasons };
}

export const ratingForScore = (score: number | null | undefined): 'Hot' | 'Warm' | 'Cold' => {
  const s = Number(score) || 0;
  return s >= 65 ? 'Hot' : s >= 40 ? 'Warm' : 'Cold';
};
