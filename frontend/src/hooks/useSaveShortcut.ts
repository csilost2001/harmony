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
 * @param allowInForm true なら INPUT/TEXTAREA 上でも発火させる
 */
export function useSaveShortcut(
  onSave: () => void,
  enabled = true,
  allowInForm = false,
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
      onSaveRef.current();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, allowInForm]);
}
