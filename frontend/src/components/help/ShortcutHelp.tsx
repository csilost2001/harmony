/**
 * キーボードショートカットの一覧。ヘッダーのキーボードの印、または「?」キーで開く。
 * 一覧画面・エディタ・画面デザイナで使えるキーが 1 か所で分かる。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { SHORTCUT_GROUPS, relevantGroupTitles, shouldOpenShortcutHelp } from "../../utils/shortcuts";
import { relevantTopics, searchHelp } from "../../utils/helpSearch";
import { BINDABLE_SHORTCUTS, comboKeys, comboOfEvent, defaultCombo, effectiveCombo, resetBinding, setBinding, useBindingsVersion } from "../../utils/shortcutBindings";
import "../../styles/shortcutHelp.css";

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // キーの割り当てを変える (続編 第 10 弾 #188)。変える行を選ぶと、次に押したキーの組み合わせが割り当てになる (Esc でやめる)
  useBindingsVersion();
  const [editing, setEditing] = useState(false);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);
  // 開いている画面に関係するグループを先頭に出して開き、ほかは折りたたむ (開くたびに、いまの画面の経路を読む)
  const relevant = relevantGroupTitles(open ? window.location.pathname : "/");
  const groups = [...SHORTCUT_GROUPS].sort((a, b) => Number(relevant.includes(b.title)) - Number(relevant.includes(a.title)));
  const pathname = open ? window.location.pathname : "/";
  const hits = query.trim() ? searchHelp(query, pathname) : [];
  const hereTopics = open && !query.trim() ? relevantTopics(pathname) : [];
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open);

  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    setQuery("");
    setEditing(false); setCapturing(null); setBindError(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && capturing) {
        // 割り当てるキーを待っている: 押したキーの組み合わせを受け取る (ほかの処理には渡さない)
        e.preventDefault(); e.stopPropagation();
        if (e.key === "Escape") { setCapturing(null); setBindError(null); return; }
        const combo = comboOfEvent(e);
        if (!combo) return; // 修飾キーだけ
        const r = setBinding(capturing, combo);
        if (r.ok) { setCapturing(null); setBindError(null); } else setBindError(r.error);
        return;
      }
      if (open && e.key === "Escape") { e.preventDefault(); hide(); return; }
      if (!open && shouldOpenShortcutHelp(e)) { e.preventDefault(); show(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, show, hide, capturing]);

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
            <div className="shortcut-help-search">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例: 物理名、閉じたタブ、ctrl s" aria-label="ヘルプとショートカットを検索" data-testid="help-search" />
            </div>
            <div className="shortcut-help-body">
              {query.trim() ? (
                <ul className="help-hits" data-testid="help-hits" aria-live="polite">
                  {hits.length === 0 && <li className="help-hit-empty">「{query.trim()}」に合うヘルプ・ショートカットはありません。</li>}
                  {hits.map((h, i) => h.kind === "topic" ? (
                    <li key={`t:${h.id}`} className="help-hit" data-testid="help-hit-topic"><b>{h.title}</b>{h.here && <span className="shortcut-help-here">この画面</span>}<p>{h.snippet}</p>{h.doc && <small>くわしい仕様書: {h.doc}</small>}</li>
                  ) : (
                    <li key={`s:${i}`} className="help-hit" data-testid="help-hit-shortcut"><span className="help-hit-keys">{h.keys.map((k, j) => <span key={j}>{j > 0 && <span className="shortcut-help-plus">+</span>}<kbd>{k}</kbd></span>)}</span> {h.label}{h.here && <span className="shortcut-help-here">この画面</span>}<small> ({h.group})</small></li>
                  ))}
                </ul>
              ) : (<>
              {hereTopics.length > 0 && (
                <section className="shortcut-help-group help-here" data-testid="help-here">
                  <h3>この画面の項目のヘルプ<span className="shortcut-help-here">この画面</span></h3>
                  <ul className="help-hits">{hereTopics.map((t) => <li key={t.id} className="help-hit"><b>{t.topic.title}</b><p>{t.topic.body[0]}</p></li>)}</ul>
                </section>
              )}
              {groups.map((g) => (
                <details key={g.title} className="shortcut-help-group" open={relevant.includes(g.title)} data-testid={`shortcut-group-${relevant.includes(g.title) ? "open" : "closed"}`}>
                  <summary><h3>{g.title}{relevant.includes(g.title) ? <span className="shortcut-help-here">この画面</span> : null}</h3></summary>
                  <dl>
                    {g.entries.map((e, i) => {
                      const keys = e.bindId ? comboKeys(effectiveCombo(e.bindId)) : e.keys;
                      const changed = !!e.bindId && effectiveCombo(e.bindId) !== defaultCombo(e.bindId);
                      return (
                        <div className="shortcut-help-row" key={i} data-testid={e.bindId ? `shortcut-row-${e.bindId}` : undefined}>
                          <dt>{capturing === e.bindId && e.bindId ? <span className="shortcut-help-capture" data-testid="shortcut-capture">割り当てるキーを押してください (Esc でやめる)</span> : keys.map((k, j) => <span key={j}>{j > 0 && <span className="shortcut-help-plus">+</span>}<kbd>{k}</kbd></span>)}</dt>
                          <dd>{e.label}{changed && <small className="shortcut-help-changed"> (変更済み。既定: {defaultCombo(e.bindId!)})</small>}
                            {editing && e.bindId && (
                              <span className="shortcut-help-edit">
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setCapturing(e.bindId!); setBindError(null); }} data-testid={`shortcut-change-${e.bindId}`}>変える</button>
                                {changed && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { resetBinding(e.bindId); setBindError(null); }} data-testid={`shortcut-reset-${e.bindId}`}>既定に戻す</button>}
                              </span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </details>
              ))}
              </>)}
            </div>
            {bindError && <p className="shortcut-help-error" role="alert" data-testid="shortcut-bind-error">{bindError}</p>}
            <p className="shortcut-help-foot">
              Mac では Ctrl を ⌘ に読み替えてください。
              <button type="button" className="btn btn-sm btn-outline-secondary" style={{ marginLeft: 8 }} aria-pressed={editing} onClick={() => { setEditing((v) => !v); setCapturing(null); setBindError(null); }} data-testid="shortcut-edit-toggle">{editing ? "割り当ての変更を終える" : "キーの割り当てを変える"}</button>
              {editing && <button type="button" className="btn btn-sm btn-outline-secondary" style={{ marginLeft: 6 }} onClick={() => { resetBinding(); setBindError(null); }} data-testid="shortcut-reset-all">すべて既定に戻す</button>}
              {editing && <small style={{ marginLeft: 8 }}>変えられるのは、{BINDABLE_SHORTCUTS.length} 件の「どこでも」のショートカットです。編集の基本のキーは固定です。</small>}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
