/**
 * 画面デザイナの紙面に流し込む、サンプル値 (UI 改善提案 続編 第 8 弾 #141)。項目の名前・型・桁数から、それらしい日本語の値を作る (画面に依存しない純関数)。
 * - typical: ふつうの値 (氏名・住所・金額など、名前から推測)
 * - long: 桁数の上限の近くまでの、長い値 (折り返し・はみ出しを見る)
 * - max: 桁数の上限いっぱい (全角の文字。数値は桁いっぱい)
 * - empty: 空
 * 同じ項目・同じ行番号なら、いつも同じ値になる (見るたびに変わらない)。
 */
export type SampleMode = "off" | "typical" | "long" | "max" | "empty";
export const SAMPLE_MODE_LABELS: Record<SampleMode, string> = { off: "なし (入力例)", typical: "ふつうの値", long: "長い値", max: "桁数いっぱい", empty: "空" };

export interface SampleItem { label?: string; id?: string; type?: unknown; maxLength?: number; min?: number; max?: number }

const NAMES = ["山田 太郎", "佐藤 花子", "鈴木 一郎", "高橋 美咲"];
const KANA = ["ヤマダ タロウ", "サトウ ハナコ", "スズキ イチロウ", "タカハシ ミサキ"];
const ADDRESSES = ["東京都千代田区丸の内1-1-1", "大阪府大阪市北区梅田2-3-4", "愛知県名古屋市中区栄3-5-6", "福岡県福岡市博多区博多駅前1-2-3"];
const NOTES = ["確認のため、後日あらためてご連絡します。", "到着時間の指定があります。午前中希望です。", "在庫が戻り次第、順次出荷いたします。"];
const FILLER = "ああああいいいいううううええええおおおお";

const hit = (s: string, ...words: string[]) => words.some((w) => s.includes(w));
const typeName = (t: unknown): string => (typeof t === "string" ? t : "string");

function repeatTo(text: string, length: number): string {
  if (length <= 0) return "";
  let out = "";
  while (out.length < length) out += text;
  return out.slice(0, length);
}

/** 項目 1 つ (一覧の列なら、その列) の、i 行目のサンプル値 */
export function sampleText(item: SampleItem, mode: SampleMode, i = 0): string {
  if (mode === "off" || mode === "empty") return "";
  const t = typeName(item.type);
  const key = `${item.label ?? ""} ${item.id ?? ""}`.toLowerCase();
  const maxLen = typeof item.maxLength === "number" && item.maxLength > 0 ? Math.min(item.maxLength, 200) : undefined;

  if (t === "boolean") return i % 2 === 0 ? "✓" : "";
  if (t === "integer" || t === "number") {
    if (mode === "max") {
      if (typeof item.max === "number") return String(item.max);
      const digits = maxLen ?? 10;
      return "9".repeat(Math.min(digits, 15));
    }
    if (mode === "long") return String(typeof item.max === "number" ? item.max : 1234567890 + i);
    const base = hit(key, "金額", "価格", "単価", "料金", "円", "amount", "price", "total") ? (i + 1) * 12800 : hit(key, "数量", "件数", "個数", "count", "qty") ? (i + 1) * 3 : (i + 1) * 120;
    const v = typeof item.min === "number" && base < item.min ? item.min : base;
    return t === "number" ? v.toLocaleString("ja-JP") : String(v);
  }
  if (t === "date") return mode === "typical" ? `2026/10/${String(16 + i).padStart(2, "0")}` : "2026/12/31";
  if (t === "datetime") return mode === "typical" ? `2026/10/${String(16 + i).padStart(2, "0")} 10:30` : "2026/12/31 23:59";

  // 文字
  let typical: string;
  if (hit(key, "カナ", "kana", "フリガナ")) typical = KANA[i % KANA.length];
  else if (hit(key, "氏名", "名前", "お名前", "担当者", "name")) typical = NAMES[i % NAMES.length];
  else if (hit(key, "住所", "所在地", "address")) typical = ADDRESSES[i % ADDRESSES.length];
  else if (hit(key, "郵便", "zip", "postal")) typical = "100-0005";
  else if (hit(key, "電話", "tel", "phone", "携帯")) typical = "03-1234-5678";
  else if (hit(key, "メール", "mail")) typical = `taro${i + 1}@example.com`;
  else if (hit(key, "コード", "code", "番号", "no.", "id")) typical = `A${String(i + 1).padStart(4, "0")}`;
  else if (hit(key, "備考", "コメント", "説明", "メモ", "理由", "note", "comment", "remark")) typical = NOTES[i % NOTES.length];
  else typical = `サンプル${i + 1}`;

  if (mode === "typical") return maxLen ? typical.slice(0, maxLen) : typical;
  if (mode === "max") return repeatTo(FILLER, maxLen ?? 60);
  // long: 上限の 9 割まで (上限が無ければ、ふつうの値を 4 倍に伸ばす)
  return maxLen ? repeatTo(`${typical}\u3000${FILLER}`, Math.max(typical.length, Math.floor(maxLen * 0.9))) : repeatTo(`${typical}\u3000${FILLER}`, Math.max(40, typical.length * 4));
}

/** 画面の状態 (紙面で確かめる): 通常 / データが無い / 読み込み中 / エラー (続編 第 8 弾 #142) */
export type PreviewState = "normal" | "empty" | "loading" | "error";
export const PREVIEW_STATE_LABELS: Record<PreviewState, string> = { normal: "通常", empty: "データなし", loading: "読み込み中", error: "エラー" };
