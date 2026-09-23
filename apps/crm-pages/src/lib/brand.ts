/**
 * The organization's brand colour, applied to `--accent` so every page shows
 * the vendor's colour, not ours. Falls back to the CRM's Prussian blue.
 */
export function applyBrand(hex: string | null | undefined) {
  const value = /^#[0-9a-f]{6}$/i.test(hex ?? '') ? (hex as string) : null;
  if (!value) return;
  const rgb = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  const root = document.documentElement;
  root.style.setProperty('--accent', rgb.join(' '));
  // Keep text on the accent readable whichever colour they chose.
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  root.style.setProperty('--on-accent', luminance > 0.62 ? '20 19 17' : '255 255 255');
}
