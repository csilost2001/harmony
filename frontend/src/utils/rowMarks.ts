/**
 * 一覧の行の印 (UI 改善提案 続編 第 6 弾 #118)。名前が他の設計と重なる・ID が規約の形式 (英小文字・数字・ハイフン) でない行に、
 * 理由の文を付ける。一覧の全件で数える (絞り込み・並びで印が変わらないように)。画面に依存しない純関数。
 * 命名規約の分析 (設計の分析画面) のような、プロジェクトごとの規則は含めない。
 */
import { isValidEntityId } from "./entityIdValidation";

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();

/** 行の id → 印の理由。問題の無い行は含まない */
export function computeRowMarks<T>(items: readonly T[], idOf: (item: T) => string, nameOf: (item: T) => string | undefined): Map<string, string> {
  const byName = new Map<string, number>();
  for (const it of items) {
    const n = norm(nameOf(it) ?? "");
    if (n) byName.set(n, (byName.get(n) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const it of items) {
    const id = idOf(it);
    const reasons: string[] = [];
    const n = norm(nameOf(it) ?? "");
    const same = n ? (byName.get(n) ?? 1) - 1 : 0;
    if (same > 0) reasons.push(`同じ名前の設計が他に ${same} 件あります`);
    if (!isValidEntityId(id)) reasons.push(`ID「${id}」が規約の形式 (英小文字・数字・ハイフン) ではありません`);
    if (reasons.length) out.set(id, reasons.join("。"));
  }
  return out;
}
