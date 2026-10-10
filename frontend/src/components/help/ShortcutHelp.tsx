/**
 * キーボードショートカットの一覧。ヘッダーのキーボードの印、または「?」キーで開く。
 * 一覧画面・エディタ・画面デザイナで使えるキーが 1 か所で分かる。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SHORTCUT_GROUPS, shouldOpenShortcutHelp } from "../../utils/shortcuts";
import "../../styles/shortcutHelp.css";

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    returnFocusTo.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === "Escape") { e.preventDefault(); hide(); return; }
      if (!open && shouldOpenShortcutHelp(e)) { e.preventDefault(); show(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, show, hide]);

  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);

  return (
    <>
      <button type="button" className="common-header-icon-btn" data-testid="shortcut-help-open"
        title="キーボードショートカット一覧 (?)" aria-label="キーボードショートカット一覧" onClick={show}>
        <i className="bi bi-keyboard" />
      </button>
      {open && (
        <div className="shortcut-help-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
          <div className="shortcut-help-modal" role="dialog" aria-modal="true" aria-label="キーボードショートカット" data-testid="shortcut-help">
            <div className="shortcut-help-head">
              <h2>キーボードショートカット</h2>
              <button type="button" ref={closeRef} className="shortcut-help-close" aria-label="閉じる" onClick={hide}><i className="bi bi-x-lg" /></button>
            </div>
            <div className="shortcut-help-body">
              {SHORTCUT_GROUPS.map((g) => (
                <section key={g.title} className="shortcut-help-group">
                  <h3>{g.title}</h3>
                  <dl>
                    {g.entries.map((e, i) => (
                      <div className="shortcut-help-row" key={i}>
                        <dt>{e.keys.map((k, j) => <span key={j}>{j > 0 && <span className="shortcut-help-plus">+</span>}<kbd>{k}</kbd></span>)}</dt>
                        <dd>{e.label}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            <p className="shortcut-help-foot">Mac では Ctrl を ⌘ に読み替えてください。</p>
          </div>
        </div>
      )}
    </>
  );
}
