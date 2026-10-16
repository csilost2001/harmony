/**
 * 表のセルの「オートフィル」の値の作り方 (UI 改善提案 第 3 弾 #53)。画面に依存しない純関数。
 * - copy: 同じ値を埋める
 * - series: 末尾の数字 (item01 → item02 → item03)・日付 (2026-10-01 → 2026-10-02 …) を 1 つずつ進める。進められない値は同じ値
 */
export type FillMode = "copy" | "series";

const DATE_RE = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/;
const TAIL_NUM_RE = /^(.*?)(\d+)$/;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** source から、count 個の値を作る (source 自身は含めない) */
export function fillValues(source: string, count: number, mode: FillMode): string[] {
  if (count <= 0) return [];
  if (mode === "series") {
    const d = DATE_RE.exec(source.trim());
    if (d) {
      const [, y, sep, m, day] = d;
      const base = Date.UTC(Number(y), Number(m) - 1, Number(day));
      const check = new Date(base);
      if (check.getUTCMonth() === Number(m) - 1) {
        const keepPad = m.length === 2 || day.length === 2;
        return Array.from({ length: count }, (_, i) => {
          const t = new Date(base + (i + 1) * 86400000);
          const mm = t.getUTCMonth() + 1;
          const dd = t.getUTCDate();
          return `${t.getUTCFullYear()}${sep}${keepPad ? pad(mm, 2) : mm}${sep}${keepPad ? pad(dd, 2) : dd}`;
        });
      }
    }
    const t = TAIL_NUM_RE.exec(source);
    if (t) {
      const [, head, digits] = t;
      const start = Number(digits);
      if (Number.isSafeInteger(start)) return Array.from({ length: count }, (_, i) => `${head}${pad(start + i + 1, digits.length)}`);
    }
  }
  return Array.from({ length: count }, () => source);
}
