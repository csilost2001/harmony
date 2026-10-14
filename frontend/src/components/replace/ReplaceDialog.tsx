/**
 * 設計全体の検索置換。名前・ラベル・説明・備考などの文章から語を探し、見つかった一覧 (置換後の文言つき) を見て、
 * 選んだものだけを置換する。置換するのは、人が読む文章の欄だけ (ID・参照・物理名・式は触れない)。
 * 編集中の設計は飛ばす。置換したあと、30 分は取り消せる。ヘッダーの「検索置換」/ Ctrl+Shift+H / コマンド「設計全体で検索・置換」で開く。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { mcpBridge } from "../../mcp/mcpBridge";
import { clearActiveTab, getActiveTabId, getTabs } from "../../store/tabStore";
import { reportFailure } from "../../utils/failureToast";
import { showToast } from "../../utils/toast";
import { onHeaderPanelRequest } from "../../utils/headerPanels";
import { CONTENT_ROUTES } from "../../utils/quickOpen";
import {
  REPLACE_KIND_ICONS, REPLACE_KIND_LABELS, afterSegments, groupByEntity, replaceableKeys, splitByQuery,
  type EntityGroup, type ReplacePreview, type ReplaceResult, type Segment,
} from "../../utils/replaceView";
import "../../styles/pasteColumns.css";
import "../../styles/replaceDialog.css";

interface UndoInfo { operationId: string; replaced: number; files: number; query: string; replacement: string; remainingMs: number }

const marks = (segs: Segment[], cls: string) => segs.map((s, i) => (s.hit ? <mark key={i} className={cls}>{s.text}</mark> : <span key={i}>{s.text}</span>));

export function ReplaceDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => onHeaderPanelRequest("replace", () => setOpen(true)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") { e.preventDefault(); setOpen(true); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return open ? <ReplacePanel onClose={() => setOpen(false)} /> : null;
}

function ReplacePanel({ onClose }: { onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  // 予行の結果は、探したときの条件といっしょに持つ (そのあと入力を変えても、見せている結果と適用する条件がずれない)
  const [preview, setPreview] = useState<{ data: ReplacePreview; query: string; replacement: string; caseSensitive: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"search" | "apply" | "undo" | null>(null);
  const [result, setResult] = useState<{ data: ReplaceResult; query: string; replacement: string } | null>(null);
  const [undo, setUndo] = useState<UndoInfo[]>([]);

  const groups = useMemo<EntityGroup[]>(() => (preview ? groupByEntity(preview.data.candidates, preview.data.blocked) : []), [preview]);
  const stale = !!preview && (preview.query !== query || preview.replacement !== replacement || preview.caseSensitive !== caseSensitive);

  const loadUndo = useCallback(() => {
    mcpBridge.request("designReplace.listUndo", {}).then((r) => setUndo((r as UndoInfo[]) ?? [])).catch(() => setUndo([]));
  }, []);
  useEffect(() => { loadUndo(); }, [loadUndo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const search = async () => {
    if (!query || busy) return;
    setBusy("search"); setResult(null);
    try {
      const data = (await mcpBridge.request("designReplace.preview", { query, replacement, caseSensitive })) as ReplacePreview;
      setPreview({ data, query, replacement, caseSensitive });
      setSelected(new Set(replaceableKeys(groupByEntity(data.candidates, data.blocked))));
    } catch (e) { reportFailure(e, "検索置換の検索", () => { void search(); }); }
    finally { setBusy(null); }
  };

  const apply = async () => {
    if (!preview || stale || busy || selected.size === 0) return;
    setBusy("apply");
    try {
      const chosen = preview.data.candidates.filter((c) => selected.has(c.key)).map((c) => ({ key: c.key, before: c.before }));
      const data = (await mcpBridge.request("designReplace.apply", { query: preview.query, replacement: preview.replacement, caseSensitive: preview.caseSensitive, selected: chosen })) as ReplaceResult;
      setResult({ data, query: preview.query, replacement: preview.replacement });
      setPreview(null); setSelected(new Set());
      if (data.replaced > 0) showToast(`${data.replaced} か所を置換しました (${data.files} ファイル)。30 分以内なら、取り消せます`, "info");
      loadUndo();
    } catch (e) { reportFailure(e, "検索置換の適用"); }
    finally { setBusy(null); }
  };

  const undoOp = async (operationId: string) => {
    if (busy) return;
    setBusy("undo");
    try {
      const r = (await mcpBridge.request("designReplace.undo", { operationId })) as { restored: number; conflicts: string[] };
      showToast(r.conflicts.length > 0
        ? `${r.restored} ファイルを元に戻しました。置換のあとで変えられた ${r.conflicts.length} ファイル (${r.conflicts.join(", ")}) は、戻していません`
        : `${r.restored} ファイルを元に戻しました`, r.conflicts.length > 0 ? "info" : "success");
      setResult(null);
      loadUndo();
    } catch (e) { reportFailure(e, "検索置換の取り消し"); loadUndo(); }
    finally { setBusy(null); }
  };

  const toggleGroup = (g: EntityGroup, on: boolean) => setSelected((cur) => { const n = new Set(cur); for (const c of g.items) { if (on) n.add(c.key); else n.delete(c.key); } return n; });
  const openEntity = (g: EntityGroup) => {
    const activeId = getActiveTabId();
    if (getTabs().some((t) => t.id === activeId && t.type === "design")) clearActiveTab();
    onClose();
    navigate(wsPath(CONTENT_ROUTES[g.kind](g.id)));
  };
  const replaceableCount = preview ? replaceableKeys(groups).length : 0;

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={trapRef} className="paste-cols-modal rp-modal" role="dialog" aria-modal="true" aria-label="設計全体の検索置換" data-testid="replace-dialog">
        <div className="paste-cols-head">
          <h2><i className="bi bi-input-cursor-text" /> 設計全体の検索置換</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <p className="paste-cols-help">
            名前・ラベル・説明・備考などの<strong>文章</strong>から語を探して置き換えます。ID・参照・物理名・式・SQL には触れません (ID を変えるときは「ID の変更」を使います)。
            見つかった一覧で、置き換えるものを選んでから適用します。編集中の設計は飛ばします。
          </p>
          <div className="rp-form">
            <label className="tbl-field"><span>探す語</span>
              <input type="text" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} placeholder="例: 顧客" data-testid="replace-query"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void search(); } }} />
            </label>
            <label className="tbl-field"><span>置き換える語 (空なら、その語を消す)</span>
              <input type="text" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="例: 取引先" data-testid="replace-replacement"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void search(); } }} />
            </label>
            <label className="rp-case"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} data-testid="replace-case" /> 大文字小文字を区別する</label>
            <button type="button" className="btn btn-sm btn-primary" disabled={!query || busy !== null} onClick={() => { void search(); }} data-testid="replace-search">
              {busy === "search" ? "探しています…" : "探す (予行)"}
            </button>
          </div>

          {undo.length > 0 && (
            <div className="rp-undo" data-testid="replace-undo-list">
              {undo.map((u) => (
                <div key={u.operationId} className="rp-undo-row">
                  <span>直前の置換: 「{u.query}」→「{u.replacement || "(消す)"}」 {u.replaced} か所 / {u.files} ファイル (あと {Math.max(1, Math.round(u.remainingMs / 60000))} 分、取り消せます)</span>
                  <button type="button" className="btn btn-sm btn-secondary" disabled={busy !== null} onClick={() => { void undoOp(u.operationId); }} data-testid="replace-undo">取り消す</button>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="rp-result" role="status" data-testid="replace-result">
              <strong>{result.data.replaced} か所を置換しました</strong> ({result.data.files} ファイル)
              {result.data.skipped.length > 0 && (
                <details>
                  <summary>{result.data.skipped.length} か所は置換しませんでした</summary>
                  <ul>{result.data.skipped.slice(0, 50).map((s) => <li key={s.key}><code>{s.key}</code>: {s.reason}</li>)}</ul>
                </details>
              )}
            </div>
          )}

          {preview && (
            <>
              {stale && <p className="rp-stale" role="status" data-testid="replace-stale">入力を変えました。「探す (予行)」で探し直してください (下の一覧は、前の条件の結果です)。</p>}
              <div className="rp-summary" data-testid="replace-summary">
                {preview.data.total === 0
                  ? `「${preview.query}」に合う文章は、見つかりませんでした。`
                  : `${preview.data.total} か所 (${preview.data.entities} 件の設計) が見つかりました。${preview.data.truncated ? `一覧には先頭の ${preview.data.candidates.length} か所だけ出しています。` : ""}`}
                {preview.data.blocked.length > 0 && ` 編集中の ${preview.data.blocked.length} 件は、置換できません。`}
              </div>
              {preview.data.candidates.length > 0 && (
                <div className="rp-tools">
                  <button type="button" className="rp-link" onClick={() => setSelected(new Set(replaceableKeys(groups)))}>すべて選ぶ</button>
                  <button type="button" className="rp-link" onClick={() => setSelected(new Set())}>すべて外す</button>
                  <span className="rp-count">{selected.size} / {replaceableCount} か所を選択中</span>
                </div>
              )}
              <div className="rp-list" data-testid="replace-list">
                {groups.map((g) => {
                  const all = g.items.every((c) => selected.has(c.key));
                  const some = g.items.some((c) => selected.has(c.key));
                  return (
                    <section key={`${g.kind}:${g.id}`} className={`rp-group${g.blocked ? " is-blocked" : ""}`} data-testid="replace-group">
                      <header>
                        <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} disabled={!!g.blocked}
                          aria-label={`${g.entityName}のすべてを選ぶ`} onChange={(e) => toggleGroup(g, e.target.checked)} />
                        <i className={`bi ${REPLACE_KIND_ICONS[g.kind]}`} />
                        <button type="button" className="rp-entity" onClick={() => openEntity(g)} title="この設計を開く">{g.entityName}</button>
                        <span className="rp-kind">{REPLACE_KIND_LABELS[g.kind]} · {g.id}</span>
                        {g.blocked && <span className="rp-blocked">{g.blocked}</span>}
                      </header>
                      <ul>
                        {g.items.map((c) => (
                          <li key={c.key}>
                            <label>
                              <input type="checkbox" checked={selected.has(c.key)} disabled={!!g.blocked}
                                onChange={(e) => setSelected((cur) => { const n = new Set(cur); if (e.target.checked) n.add(c.key); else n.delete(c.key); return n; })} data-testid="replace-item" />
                              <span className="rp-where">{c.where}</span>
                            </label>
                            <div className="rp-diff">
                              <span className="rp-before">{marks(splitByQuery(c.before, preview.query, preview.caseSensitive), "rp-hit-before")}</span>
                              <i className="bi bi-arrow-right" aria-label="から" />
                              <span className="rp-after">{marks(afterSegments(c.before, preview.query, preview.replacement, preview.caseSensitive), "rp-hit-after")}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="paste-cols-foot">
          <span className="bulk-count">{preview && !stale && selected.size > 0 ? `${selected.size} か所を置換します (取り消せます)` : ""}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>閉じる</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={!preview || stale || selected.size === 0 || busy !== null} onClick={() => { void apply(); }} data-testid="replace-apply">
            {busy === "apply" ? "置換しています…" : `${selected.size} か所を置換`}
          </button>
        </div>
      </div>
    </div>
  );
}
