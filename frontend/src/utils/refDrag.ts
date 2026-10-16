/**
 * 一覧・木の項目を、入力欄へドラッグして、参照 (@screen.cart のような指定) を入れる (UI 改善提案 第 3 弾 #51)。
 * ドラッグするものは、参照の文字を、専用の種類 (REF_MIME) と、ふつうの文字 (text/plain) の両方で持つ。
 * 入力欄は REF_MIME のドラッグだけを受ける (ふつうの文字のドラッグは、ブラウザの標準のまま)。
 * 並べて表示 (別の枠の中の一覧) からのドラッグも、同じ形で受ける。
 */
export const REF_MIME = "application/x-harmony-ref";

type DT = Pick<DataTransfer, "types" | "getData">;
type DTWrite = Pick<DataTransfer, "setData"> & { effectAllowed: DataTransfer["effectAllowed"] };

/** ドラッグ開始時に、参照の文字を持たせる */
export function setRefDragData(dt: DTWrite, text: string): void {
  dt.setData(REF_MIME, text);
  dt.setData("text/plain", text);
  dt.effectAllowed = "copyMove";
}

/** 参照のドラッグか (dragover の間は、中身を読めないので、種類だけで判定する) */
export function hasRefDrag(dt: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return !!dt && Array.from(dt.types).includes(REF_MIME);
}

const REF_TEXT = /^@[A-Za-z]+(?:\.[A-Za-z0-9_.-]+)?$/;

/** ドロップされた参照の文字 (参照の形でなければ null) */
export function readRefDrop(dt: DT | null | undefined): string | null {
  if (!dt || !hasRefDrag(dt)) return null;
  const text = dt.getData(REF_MIME).trim();
  return REF_TEXT.test(text) ? text : null;
}

/** 入力欄の、選択している範囲 (無ければカーソルの位置) へ、参照を入れる。新しい文字と、入れたあとのカーソルの位置を返す */
export function insertRefAt(value: string, start: number, end: number, ref: string): { value: string; cursor: number } {
  const s = Math.min(Math.max(start, 0), value.length);
  const e = Math.min(Math.max(end, s), value.length);
  return { value: value.slice(0, s) + ref + value.slice(e), cursor: s + ref.length };
}
