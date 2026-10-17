/**
 * キーボードのフォーカスで出るツールチップ (UI 改善提案 続編 第 10 弾 #196)。
 * ボタンの説明 (title) は、マウスを乗せたときしか出ず、キーボードで移動する人には届かない。フォーカスが (キーボード操作で) 当たった要素の title を、
 * 同じ文のまま、画面に出す。末尾の「(Ctrl+S)」のようなキーは、kbd で見せる。マウスでは、ブラウザ標準の title の表示のまま (二重に出さない)。
 * Esc で消せる (WCAG 1.4.13)。title の文は、要素に残す (読み上げ・既存の操作はそのまま)。
 */
import { useEffect, useState } from "react";
import { splitTooltip } from "../../utils/tooltipText";
import "../../styles/focusTooltip.css";

interface Shown { text: string; keys: string[]; x: number; y: number }
const GAP = 8;
const SHOW_DELAY_MS = 350;


export function FocusTooltips() {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 直前の操作が、キーボードか (マウス・タッチで当たったフォーカスには、出さない。ブラウザ標準の title が出るため)
    let keyboard = false;
    const hide = () => { clearTimeout(timer); setShown(null); };
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[title]") as HTMLElement | null;
      clearTimeout(timer);
      const active = document.activeElement;
      if (!el || !active || !el.contains(active) || !keyboard) { setShown(null); return; }
      const title = el.getAttribute("title")?.trim();
      if (!title) { setShown(null); return; }
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const parts = splitTooltip(title);
        setShown({ ...parts, x: Math.max(8, Math.min(r.left, window.innerWidth - 320)), y: r.bottom + GAP > window.innerHeight - 48 ? Math.max(8, r.top - 40) : r.bottom + GAP });
      }, SHOW_DELAY_MS);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); else if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) keyboard = true; };
    const onPointer = () => { keyboard = false; hide(); };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="focus-tooltip" role="tooltip" style={{ left: shown.x, top: shown.y }} data-testid="focus-tooltip">
      <span>{shown.text}</span>
      {shown.keys.length > 0 && <span className="focus-tooltip-keys">{shown.keys.map((k, i) => <span key={i}>{i > 0 && "+"}<kbd>{k}</kbd></span>)}</span>}
    </div>
  );
}
