// WCAG contrast for the CRM tokens. Parses apps/crm/src/index.css when it exists,
// otherwise the candidate palette below. Run: node scripts/check-contrast.mjs
import fs from 'node:fs';

const lum = ([r, g, b]) => {
  const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg, a) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));

function parse(css, selector) {
  const block = css.split(selector)[1]?.split('}')[0] ?? '';
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) out[m[1]] = [+m[2], +m[3], +m[4]];
  return out;
}

const cssPath = new URL('../apps/crm/src/index.css', import.meta.url);
const css = fs.readFileSync(cssPath, 'utf8');
const themes = { light: parse(css, ':root {'), dark: parse(css, '.dark {') };

const TEXT = ['ink', 'ink-2', 'ink-3', 'accent', 'success', 'warning', 'danger', 'info'];
const SURF = ['card', 'paper', 'sunken', 'hover'];
let fails = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n== ${name}`);
  for (const fg of TEXT) {
    const cells = SURF.map(s => { const r = ratio(t[fg], t[s]); if (r < 4.5) fails++; return `${s} ${r.toFixed(2)}${r < 4.5 ? ' ✗' : ''}`; });
    console.log(`${fg.padEnd(8)} ${cells.join('  ')}`);
  }
  // tone text on its own 10% wash over card (badges)
  for (const tone of ['accent', 'success', 'warning', 'danger', 'info']) {
    const wash = over(t[tone], t.card, name === 'dark' ? 0.16 : 0.1);
    const r = ratio(t[tone], wash); if (r < 4.5) fails++;
    console.log(`${tone} on its wash ${r.toFixed(2)}${r < 4.5 ? ' ✗' : ''}`);
  }
  const onA = ratio(t['on-accent'], t.accent); if (onA < 4.5) fails++;
  console.log(`on-accent on accent ${onA.toFixed(2)}`);
  const onP = ratio(t['on-primary'], t.primary); if (onP < 4.5) fails++;
  console.log(`on-primary on primary ${onP.toFixed(2)}`);
  for (const s of ['card', 'sunken']) { const r = ratio(t.control, t[s]); if (r < 3) fails++; console.log(`control on ${s} ${r.toFixed(2)} (needs 3)`); }
  const sel = over(t.accent, t.card, name === 'dark' ? 0.14 : 0.08);
  for (const fg of ['ink', 'ink-2', 'ink-3']) { const r = ratio(t[fg], sel); if (r < 4.5) fails++; console.log(`${fg} on selection wash ${r.toFixed(2)}`); }
}
console.log(fails ? `\n${fails} failures` : '\nall pass');
process.exit(fails ? 1 : 0);
