/**
 * 設計書の体裁 (社内様式) と、改訂履歴の編集。保存すると `<データフォルダ>/document-template.json` に書かれ、設計書 (HTML・Word・Excel) に反映される。
 * 設計そのもの (原本) は書き換えない。載せない章は、章番号を詰めて振り直す。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildDesignDocument, DEFAULT_DOCUMENT_TITLE, DEFAULT_STAMPS, emptyDocTemplate, isIsoDate, type DesignDocInput, type DocTemplate, type Revision } from "@harmony/shared";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { reportFailure } from "../../utils/failureToast";
import { opsApi } from "../../utils/opsApi";
import { getUserName } from "../../utils/userIdentity";
import { showToast } from "../../utils/toast";
import { nextVersion } from "./docTemplateUtil";
import { revisionDraftText } from "../../utils/designHistory";
import "../../styles/pasteColumns.css";
import "../../styles/docTemplate.css";

type Tab = "style" | "chapters" | "revisions";
const TABS: Array<{ id: Tab; label: string }> = [{ id: "style", label: "体裁" }, { id: "chapters", label: "載せる章" }, { id: "revisions", label: "改訂履歴" }];

interface Props { input: DesignDocInput; onClose: () => void; onSaved: () => void }

export function DocTemplateDialog({ input, onClose, onSaved }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [tab, setTab] = useState<Tab>("style");
  const [t, setT] = useState<DocTemplate>(() => structuredClone(input.template ?? emptyDocTemplate()));
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 最新のファイルの状態 (読めない項目の有無) を知る
  useEffect(() => { opsApi.templateLoad().then((r) => setProblems(r.problems)).catch((e) => reportFailure(e, "設計書の体裁の読み込み")); }, []);

  // 載せる章の候補は、体裁なしで作った目次から (除いた章も選び直せるように)
  const chapters = useMemo(() => buildDesignDocument({ ...input, template: { ...emptyDocTemplate(), revisions: [] } }).toc.filter((c) => c.level === 1 && c.id !== "cover"), [input]);

  const set = <K extends keyof DocTemplate>(k: K, v: DocTemplate[K] | undefined) => setT((cur) => { const n = { ...cur }; if (v === undefined || v === "") delete n[k]; else n[k] = v as never; return n; });
  const text = (k: "documentTitle" | "subtitle" | "docNumber" | "organization" | "author" | "classification" | "headerText" | "footerText", label: string, placeholder: string) => (
    <label className="dt-field">{label}<input type="text" value={t[k] ?? ""} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} data-testid={`dt-${k}`} /></label>
  );
  const stamps = t.stamps ?? DEFAULT_STAMPS;

  const updateRev = (i: number, patch: Partial<Revision>) => setT((cur) => ({ ...cur, revisions: cur.revisions.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRev = (summary = "") => setT((cur) => ({ ...cur, revisions: [...cur.revisions, { version: nextVersion(cur.revisions.at(-1)?.version), date: new Date().toISOString().slice(0, 10), author: getUserName() || undefined, summary }] }));
  const [sinceDate, setSinceDate] = useState("");
  const draftFromChanges = async () => {
    try {
      const s = await opsApi.revisionsSuggest(sinceDate || undefined);
      if (!s.items.length) { showToast(sinceDate ? `${sinceDate} 以降に更新された設計は、見つかりませんでした` : "前回の改訂のあとに更新された設計は、見つかりませんでした"); return; }
      // 変更の記録から、誰が変えたかを添える (取れなければ、更新の回数だけ)
      const audit = await (async () => { try { return (await opsApi.auditList({ limit: 2000 })).entries; } catch { return []; } })();
      const text = revisionDraftText(s.items, audit, s.since);
      addRev(`${text}${s.truncated ? "\n(ほかにも更新があります)" : ""}`);
      setTab("revisions");
      showToast(`${s.items.length} 件の更新から、改訂履歴の下書きを作りました`);
    } catch (e) { reportFailure(e, "改訂履歴の下書き"); }
  };

  const invalid = t.revisions.some((r) => !r.version.trim() || !isIsoDate(r.date) || !r.summary.trim());
  const save = async () => {
    setSaving(true); setError(null);
    try { await opsApi.templateSave({ ...t, revisions: t.revisions.map((r) => ({ ...r, author: r.author?.trim() || undefined })) }, problems.length > 0); showToast("設計書の体裁を保存しました"); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={trapRef} className="paste-cols-modal dt-modal" role="dialog" aria-modal="true" aria-label="設計書の体裁と改訂履歴" data-testid="doc-template-dialog">
        <div className="paste-cols-head">
          <h2><i className="bi bi-file-earmark-richtext" /> 設計書の体裁と改訂履歴</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <nav className="dt-tabs" role="tablist" aria-label="設定の種類">
          {TABS.map((x) => <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)} data-testid={`dt-tab-${x.id}`}>{x.label}</button>)}
        </nav>
        <div className="paste-cols-body">
          {problems.length > 0 && <p className="paste-cols-warnings" role="alert" data-testid="dt-problems">設定ファイルに読めない項目があります。保存すると、読めない項目は捨てられます: {problems.join(" / ")}</p>}
          {tab === "style" && (
            <div className="dt-grid">
              {text("documentTitle", "文書名", `例: ${DEFAULT_DOCUMENT_TITLE}`)}
              {text("subtitle", "表紙の副題", "例: 受注管理システム 第 2 版")}
              {text("docNumber", "文書番号", "例: DD-2026-014")}
              {text("organization", "組織名", "例: 開発部")}
              {text("author", "作成者", "例: 山田 太郎")}
              {text("classification", "秘区分", "例: 社外秘")}
              {text("headerText", "ヘッダー (Word)", "既定: プロジェクト名と文書名")}
              {text("footerText", "フッター (Word)", "既定: 秘区分と組織名")}
              <label className="dt-field">強調の色 (表紙の線・章の見出しの下線)
                <span className="dt-color"><input type="color" value={t.accentColor ?? "#1d2433"} onChange={(e) => set("accentColor", e.target.value)} aria-label="強調の色" data-testid="dt-accentColor" />
                  <button type="button" className="btn btn-sm btn-secondary" disabled={!t.accentColor} onClick={() => set("accentColor", undefined)}>既定に戻す</button></span>
              </label>
              <label className="dt-field">押印欄の見出し (カンマ区切り。空にすると押印欄を出さない)
                <input type="text" value={stamps.join(",")} onChange={(e) => set("stamps", e.target.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean))} data-testid="dt-stamps" />
              </label>
            </div>
          )}
          {tab === "chapters" && (
            <div className="dt-chapters" data-testid="dt-chapters">
              <p className="paste-cols-help">外した章は、設計書 (HTML・Word・Excel) に載りません。章番号は、載せる章だけで振り直します。要確認事項の検査は、外した章も対象のままです。</p>
              <ul>
                {chapters.map((c) => {
                  const out = t.excludeChapters.includes(c.id);
                  return (
                    <li key={c.id}><label><input type="checkbox" checked={!out} data-testid={`dt-chapter-${c.id}`}
                      onChange={(e) => set("excludeChapters", e.target.checked ? t.excludeChapters.filter((x) => x !== c.id) : [...t.excludeChapters, c.id])} /> {c.title}</label></li>
                  );
                })}
              </ul>
            </div>
          )}
          {tab === "revisions" && (
            <div className="dt-revs" data-testid="dt-revisions">
              <p className="paste-cols-help">設計書の表紙のあとに、改訂履歴の表として載ります (新しい版が上)。「更新から下書き」は、前回の改訂のあとに保存された設計 (保存前の版の記録) を拾って、変更の要約を作ります。</p>
              <div className="dt-rev-actions">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => addRev()} data-testid="dt-rev-add"><i className="bi bi-plus-lg" /> 版を追加</button>
                <label className="dt-since" title="この日から後に更新された設計を拾います。空にすると、前回の改訂の日から (改訂がなければ 14 日前から)">期間の始まり <input type="date" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)} data-testid="dt-rev-since" /></label>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void draftFromChanges()} data-testid="dt-rev-suggest"><i className="bi bi-magic" /> 更新から下書き</button>
              </div>
              {t.revisions.length === 0 ? <p className="paste-cols-dup">改訂履歴はまだありません。</p> : (
                <table className="dt-rev-table">
                  <thead><tr><th>版</th><th>日付</th><th>変更者</th><th>内容</th><th /></tr></thead>
                  <tbody>
                    {t.revisions.map((r, i) => (
                      <tr key={i} data-testid="dt-rev-row">
                        <td><input type="text" value={r.version} aria-label="版" onChange={(e) => updateRev(i, { version: e.target.value })} className="dt-w-ver" /></td>
                        <td><input type="date" value={r.date} aria-label="日付" onChange={(e) => updateRev(i, { date: e.target.value })} /></td>
                        <td><input type="text" value={r.author ?? ""} aria-label="変更者" onChange={(e) => updateRev(i, { author: e.target.value })} className="dt-w-author" /></td>
                        <td><textarea rows={2} value={r.summary} aria-label="内容" onChange={(e) => updateRev(i, { summary: e.target.value })} /></td>
                        <td><button type="button" className="btn btn-sm btn-secondary" aria-label={`${r.version} を削除`} onClick={() => setT((cur) => ({ ...cur, revisions: cur.revisions.filter((_, j) => j !== i) }))}><i className="bi bi-trash" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {error && <p className="paste-cols-warnings" role="alert" data-testid="dt-error">{error}</p>}
        </div>
        <div className="paste-cols-foot">
          <span className="dt-foot-note">{invalid ? "改訂履歴の版・日付 (YYYY-MM-DD)・内容を、すべて書いてください" : ""}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>キャンセル</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={saving || invalid} onClick={() => void save()} data-testid="dt-save">保存</button>
        </div>
      </div>
    </div>
  );
}
