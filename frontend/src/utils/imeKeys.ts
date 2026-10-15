/**
 * 日本語入力 (IME) の変換中かどうか。
 *
 * 変換中の Enter は「変換の確定」であって「入力の確定」ではない。Enter で送信・追加・確定する
 * 処理は、先頭でこれを見て、変換中なら何もしない (さもないと、変換を確定しただけで送信される)。
 * Safari は変換確定の keydown が isComposing = false で届くため、keyCode 229 も見る。
 */
export interface KeyEventLike {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

export function isImeComposing(e: KeyEventLike): boolean {
  return !!(e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229 || e.nativeEvent?.keyCode === 229);
}

/** Enter (Shift なし) で、変換中ではないときだけ true。送信・追加・確定の条件に使う。 */
export function isPlainEnter(e: KeyEventLike & { key: string; shiftKey?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !isImeComposing(e);
}
