/**
 * `color-mix(in srgb, ...)` は、ブラウザの計算後の値では `color(srgb 0.2 0.3 0.4 / 0.5)` になる。
 * 画面を画像にする html2canvas は、この書き方を読めず失敗する (「unsupported color function "color"」)。
 * 画像にする前に、`color(srgb ...)` を `rgba(...)` に書き換えるための関数 (画面に依存しない)。
 */
const FUNC = /color\(\s*srgb\s+([^)]+)\)/gi;

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)));
const channel = (s: string): number => (s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s));

/** `color(srgb r g b [/ a])` の中身 ("0.2 0.3 0.4 / 0.5") を rgba 文字列にする。読めなければ null */
export function srgbArgsToRgba(args: string): string | null {
  const [rgb, alpha] = args.split("/").map((x) => x.trim());
  const parts = rgb.split(/\s+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map(channel);
  if (![r, g, b].every(Number.isFinite)) return null;
  const a = alpha === undefined ? 1 : channel(alpha);
  if (!Number.isFinite(a)) return null;
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000})`;
}

/** 文字列の中の `color(srgb ...)` を、すべて rgba(...) にする (box-shadow・グラデーションの中のものも) */
export function replaceColorFunctions(value: string): string {
  return value.replace(FUNC, (whole, args: string) => srgbArgsToRgba(args) ?? whole);
}

export function hasColorFunction(value: string): boolean {
  FUNC.lastIndex = 0;
  return FUNC.test(value);
}
