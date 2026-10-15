/**
 * キーボードショートカットの一覧。ヘッダーのキーボードの印、または「?」キーで開く。
 * 一覧画面・エディタ・画面デザイナで使えるキーが 1 か所で分かる。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { SHORTCUT_GROUPS, relevantGroupTitles, shouldOpenShortcutHelp } from "../../utils/shortcuts";
import "../../styles/shortcutHelp.css";

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  // 開いている画面に関係するグループを先頭に出して開き、ほかは折りたたむ (開くたびに、いまの画面の経路を読む)
  const relevant = relevantGroupTitles(open ? window.location.pathname : "/");
  const groups = [...SHORTCUT_GROUPS].sort((a, b) => Number(relevant.includes(b.title)) - Number(relevant.includes(a.title)));
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open);

  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === "Escape") { e.preventDefault(); hide(); return; }
      if (!open && shouldOpenShortcutHelp(e)) { e.preventDefault(); show(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, show, hide]);

  return (
    <>
      <button type="button" className="common-header-icon-btn" data-testid="shortcut-help-open"
        title="キーボードショートカット一覧 (?)" aria-label="キーボードショートカット一覧" onClick={show}>
        <i className="bi bi-keyboard" />
      </button>
      {open && (
        <div className="shortcut-help-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
          <div ref={trapRef} className="shortcut-help-modal" role="dialog" aria-modal="true" aria-label="キーボードショートカット" data-testid="shortcut-help">
            <div className="shortcut-help-head">
              <h2>キーボードショートカット</h2>
              <button type="button" className="shortcut-help-close" aria-label="閉じる" onClick={hide}><i className="bi bi-x-lg" /></button>
            </div>
            <div className="shortcut-help-body">
              {groups.map((g) => (
                <details key={g.title} className="shortcut-help-group" open={relevant.includes(g.title)} data-testid={`shortcut-group-${relevant.includes(g.title) ? "open" : "closed"}`}>
                  <summary><h3>{g.title}{relevant.includes(g.title) ? <span className="shortcut-help-here">この画面</span> : null}</h3></summary>
                  <dl>
                    {g.entries.map((e, i) => (
                      <div className="shortcut-help-row" key={i}>
                        <dt>{e.keys.map((k, j) => <span key={j}>{j > 0 && <span className="shortcut-help-plus">+</span>}<kbd>{k}</kbd></span>)}</dt>
                        <dd>{e.label}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </div>
            <p className="shortcut-help-foot">Mac では Ctrl を ⌘ に読み替えてください。</p>
          </div>
        </div>
      )}
    </>
  );
}
