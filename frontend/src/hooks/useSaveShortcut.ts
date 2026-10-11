import { useEffect, useRef } from "react";

/**
 * キーイベントが「保存ショートカット」として発火すべきかを判定する純関数。
 * デフォルトでは `<input>` / `<textarea>` / `<select>` / contenteditable に
 * フォーカスがあるときは発火しない（フォーム編集中の誤保存を防ぐ）。
 *
 * テスト容易性のためエクスポートしている。
 */
export function shouldTriggerSaveShortcut(
  e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key" | "target">,
  allowInForm = false,
): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl || e.key !== "s") return false;
  if (allowInForm) return true;

  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  if (target?.isContentEditable) return false;
  return true;
}

/**
 * Ctrl+S / Cmd+S で保存ハンドラを呼ぶキーバインドフック。
 *
 * @param onSave 保存ハンドラ
 * @param enabled false のとき登録しない
 * @param allowInForm true (既定) なら INPUT/TEXTAREA 上でも発火させる。入力欄にいるときに押しても
 *   ブラウザの「名前を付けて保存」を出さず、入力欄を確定 (blur) してから保存する (保存後は元の欄に戻る)
 */
export function useSaveShortcut(
  onSave: () => void,
  enabled = true,
  allowInForm = true,
): void {
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (!shouldTriggerSaveShortcut(e, allowInForm)) return;
      e.preventDefault();
      // ダイアログの中では、背後のエディタを保存しない (貼り付け欄・ID 変更などで Ctrl+S を押しても、ブラウザの保存ダイアログは出さず、何もしない)
      if ((e.target as HTMLElement | null)?.closest?.('[aria-modal="true"]')) return;
      const el = e.target as HTMLElement | null;
      const inField = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (!inField) {
        onSaveRef.current();
        return;
      }
      // 入力欄の確定 (blur で値を確定する欄がある) を待ってから保存し、元の欄に戻る
      el.blur();
      setTimeout(() => {
        onSaveRef.current();
        if (el.isConnected) el.focus();
      }, 0);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, allowInForm]);
}
