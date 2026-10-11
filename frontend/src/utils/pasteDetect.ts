/**
 * Excel などからコピーした表 (タブ区切り・複数セル) が、クリップボードにあるか。
 * 一覧・表の上で Ctrl+V を押したとき、アプリ内のコピーが無く、表がクリップボードにあれば、
 * 「表から貼り付け」を開くために使う。1 セルだけ (タブも改行もない) の貼り付けは、表とみなさない。
 */
export function looksLikeSpreadsheet(text: string | undefined | null): boolean {
  if (!text) return false;
  return text.includes("\t") && text.trim().length > 0;
}

/** 入力欄・テキスト領域・編集可能な領域の中の貼り付けか (そこは、ふつうの貼り付けにする) */
export function isPasteIntoField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
}
