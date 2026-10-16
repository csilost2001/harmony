/**
 * ID・物理名・コードの欄の、全角・空白の正規化と、日本語入力に合わせた入力モード (UI 改善提案 第 5 弾 #93・#94)。画面に依存しない純関数。
 * - 貼り付け・入力のあと、全角の英数・記号・スペースを半角にし、前後の空白を取る (名称の欄は、変換しない)
 * - 半角英数の欄には、日本語入力・自動の大文字化・自動修正が働かないよう、属性を付ける
 */
/** NFKC で、全角の英数・記号・スペースと、半角カナを正規化し、前後の空白を除く。長音「ー」などは、そのまま */
export function normalizeAscii(s: string): string {
  return s.normalize("NFKC").trim();
}

export interface NormalizeResult { value: string; changed: boolean }

/** 貼り付けた文字は、前後の空白と改行も除く (コピー元の末尾の改行が入りやすいため) */
export function normalizePasted(s: string): NormalizeResult {
  const value = normalizeAscii(s).replace(/[\r\n\t]+/g, "");
  return { value, changed: value !== s };
}

export function normalizeField(s: string): NormalizeResult {
  const value = normalizeAscii(s);
  return { value, changed: value !== s };
}

/** 半角英数に直した結果が、元と比べて「全角を直した」と言えるか (前後の空白だけの違いは、知らせない) */
export function describeNormalization(before: string, after: string): string {
  const onlySpaces = before.trim() === after;
  return onlySpaces ? "前後の空白を取りました" : `全角を半角にしました: 「${before.length > 24 ? `${before.slice(0, 24)}…` : before}」→「${after.length > 24 ? `${after.slice(0, 24)}…` : after}」`;
}

/** 欄に付ける印。`data-norm="ascii"` の欄が、貼り付け・入力のあとに、正規化される (useFieldNormalizer) */
export const asciiFieldProps = {
  "data-norm": "ascii",
  autoCapitalize: "off",
  autoCorrect: "off",
  autoComplete: "off",
  spellCheck: false,
  lang: "en",
  inputMode: "text",
} as const;
