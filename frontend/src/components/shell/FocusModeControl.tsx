/**
 * 入力専用モードのキー (Ctrl+Alt+F) と、戻すための小さなボタン (UI 改善提案 第 5 弾 #98)。
 */
import { matchesBinding } from "../../utils/shortcutBindings";
import { useEffect } from "react";
import { installFocusMode, setFocusMode, toggleFocusMode, useFocusMode } from "../../store/focusMode";

export function FocusModeControl() {
  const on = useFocusMode();
  useEffect(() => {
    installFocusMode();
    const onKey = (e: KeyboardEvent) => {
      if (matchesBinding(e, "focusMode")) { e.preventDefault(); toggleFocusMode(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!on) return null;
  return (
    <button type="button" className="focus-mode-exit" onClick={() => setFocusMode(false)} title="入力専用モードをやめて、ヘッダーとタブを出す (Ctrl+Alt+F)" data-testid="focus-mode-exit">
      <i className="bi bi-fullscreen-exit" /> 入力専用モード (Ctrl+Alt+F で戻す)
    </button>
  );
}
