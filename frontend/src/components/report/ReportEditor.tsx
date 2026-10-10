/**
 * 帳票編集 (/report/edit/:reportId)。
 *
 * 左: 基本設定 (出力・契機・出力条件) と部の一覧 / 中央: 用紙の見本図 (原本から自動で描く) と要確認 /
 * 右: 選んだ部・項目の設定。見本図の項目をクリックで選び、右で種類・出どころ・書式・揃え・幅を決める。
 * 編集は「編集開始」で編集セッションを作って行い (他の人・AI は閲覧のみ)、保存は明示的 (開いただけでは書き換えない)。
 * 仕様: docs/spec/report.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  REPORT_AGGREGATE_LABELS, REPORT_FIELD_KIND_LABELS, REPORT_FORMAT_LABELS, REPORT_SECTION_LABELS,
  defaultSectionName, nextReportFieldId, nextReportSectionId, reportToHtml, validateReport,
  type Report, type ReportAggregate, type ReportField, type ReportFieldKind, type ReportParam, type ReportSection, type ReportSectionKind,
} from "@harmony/shared";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { listProcessFlows } from "../../store/processFlowStore";
import { listTables, loadTable } from "../../store/tableStore";
import { loadReport } from "../../store/reportStore";
import { useEditableDocument } from "../../hooks/useEditableDocument";
import { EditSessionChrome } from "../editing/EditSessionChrome";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import { SortableList, SortableRow } from "../common/SortableList";
import { moveById } from "../../utils/reorder";
import "../../styles/businessFlow.css";
import "../../styles/report.css";

type Selection = { sectionId: string; fieldId?: string } | null;
const SECTION_KINDS = Object.keys(REPORT_SECTION_LABELS) as ReportSectionKind[];
const FIELD_KINDS = Object.keys(REPORT_FIELD_KIND_LABELS) as ReportFieldKind[];

interface TableOpt { id: string; name: string; columns: Array<{ physicalName: string; name: string }> }

export function ReportEditor() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [screens, setScreens] = useState<Array<{ id: string; name: string }>>([]);
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [tables, setTables] = useState<TableOpt[]>([]);

  // ── 文書 (編集セッション・元に戻す・他の保存の検知は useEditableDocument) ──
  const {
    doc: report, editable, mode, sessionLoading, dirty, apply: applyDoc, undo, redo, canUndo, canRedo,
    attach, takeOver, syncSessionToUrl, sessionId, chrome,
  } = useEditableDocument<Report>({
    resourceType: "report",
    tabType: "report",
    mtimeKind: "report",
    draftKind: "report",
    id: reportId,
    load: loadReport,
    broadcastName: "reportChanged",
    broadcastIdField: "reportId",
    onNotFound: () => setMissing(true),
    autoEditKey: "report",
  });
  // 変更の関数は、複製した文書を書き換えて返す (同じ結果なら何もしない)
  const apply = useCallback((fn: (r: Report) => Report) => applyDoc(fn), [applyDoc]);

  useEffect(() => {
    if (!reportId) return;
    let alive = true;
    mcpBridge.startWithoutEditor();
    loadProject().then((p) => { if (alive) setScreens(p.screens.map((s) => ({ id: s.id as string, name: s.name as string }))); }).catch(() => undefined);
    listProcessFlows().then((l) => { if (alive) setFlows(l.map((m) => ({ id: m.id as string, name: (m.name as string) ?? (m.id as string) }))); }).catch(() => undefined);
    listTables().then(async (metas) => {
      const loaded = await Promise.all(metas.map((m) => loadTable(m.id as string).catch(() => null)));
      if (alive) setTables(loaded.filter(Boolean).map((t) => ({
        id: t!.id as string, name: (t!.name as string) ?? (t!.id as string),
        columns: ((t!.columns ?? []) as Array<{ physicalName: string; name?: string }>).map((c) => ({ physicalName: c.physicalName, name: c.name ?? c.physicalName })),
      })));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [reportId]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // 取り消し・読み直しで消えた部・項目の選択は外す
  useEffect(() => {
    if (!report || !selection) return;
    const sec = report.sections.find((s) => s.id === selection.sectionId);
    if (!sec || (selection.fieldId && !sec.fields.some((f) => f.id === selection.fieldId))) setSelection(null);
  }, [report, selection]);

  // ── 検証・見本図 ──
  const refs = useMemo(() => ({
    screens: screens.length ? new Set(screens.map((s) => s.id)) : undefined,
    flows: flows.length ? new Set(flows.map((f) => f.id)) : undefined,
    tables: tables.length ? new Map(tables.map((t) => [t.id, new Set(t.columns.map((c) => c.physicalName))] as const)) : undefined,
  }), [screens, flows, tables]);
  const issues = useMemo(() => (report ? validateReport(report, refs) : []), [report, refs]);
  const html = useMemo(() => (report ? reportToHtml(report, { interactive: true, selected: selection ?? undefined }) : ""), [report, selection]);

  const section = report && selection ? report.sections.find((s) => s.id === selection.sectionId) : undefined;
  const field = section && selection?.fieldId ? section.fields.find((f) => f.id === selection.fieldId) : undefined;

  // ── 部・項目の操作 ──
  const patchReport = (patch: (r: Report) => void) => apply((r) => { patch(r); return r; });
  const patchSection = (id: string, patch: Partial<ReportSection>) => apply((r) => {
    const s = r.sections.find((x) => x.id === id);
    if (s) for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") delete (s as unknown as Record<string, unknown>)[k]; else (s as unknown as Record<string, unknown>)[k] = v; }
    return r;
  });
  const patchField = (sid: string, fid: string, patch: Partial<ReportField>) => apply((r) => {
    const f = r.sections.find((x) => x.id === sid)?.fields.find((x) => x.id === fid);
    if (f) for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") delete (f as unknown as Record<string, unknown>)[k]; else (f as unknown as Record<string, unknown>)[k] = v; }
    return r;
  });
  const addSection = (kind: ReportSectionKind) => {
    if (!report) return;
    const id = nextReportSectionId(report);
    apply((r) => {
      // 明細部の前後に収まるよう、種類の標準の順に挿入する
      const order = SECTION_KINDS;
      const at = r.sections.findIndex((s) => order.indexOf(s.kind) > order.indexOf(kind));
      const sec: ReportSection = { id, kind, name: defaultSectionName(kind), fields: [] };
      if (at < 0) r.sections.push(sec); else r.sections.splice(at, 0, sec);
      return r;
    });
    setSelection({ sectionId: id });
  };
  const moveSection = (id: string, d: -1 | 1) => apply((r) => {
    const i = r.sections.findIndex((s) => s.id === id), j = i + d;
    if (i >= 0 && j >= 0 && j < r.sections.length) [r.sections[i], r.sections[j]] = [r.sections[j], r.sections[i]];
    return r;
  });
  const reorderSections = (activeId: string, overId: string) => apply((r) => { moveById(r.sections, activeId, overId); return r; });
  const reorderFields = (sid: string, activeId: string, overId: string) => apply((r) => {
    const fs = r.sections.find((s) => s.id === sid)?.fields;
    if (fs) moveById(fs, activeId, overId);
    return r;
  });
  const deleteSection = (id: string) => { apply((r) => { r.sections = r.sections.filter((s) => s.id !== id); return r; }); setSelection(null); };
  const addField = (sid: string, kind?: ReportFieldKind) => {
    if (!report) return;
    const sec = report.sections.find((s) => s.id === sid);
    if (!sec) return;
    const k: ReportFieldKind = kind ?? (sec.kind === "detail" ? "field" : sec.kind === "reportFooter" || sec.kind === "groupFooter" ? "aggregate" : "text");
    const id = nextReportFieldId(report);
    apply((r) => {
      const f: ReportField = { id, kind: k, label: k === "text" ? "文言" : k === "pageNumber" || k === "date" ? undefined : "新しい項目" };
      if (k === "aggregate") f.aggregate = "sum";
      if (!f.label) delete f.label;
      r.sections.find((s) => s.id === sid)!.fields.push(f);
      return r;
    });
    setSelection({ sectionId: sid, fieldId: id });
  };
  const moveField = (sid: string, fid: string, d: -1 | 1) => apply((r) => {
    const fs = r.sections.find((s) => s.id === sid)?.fields;
    if (!fs) return r;
    const i = fs.findIndex((f) => f.id === fid), j = i + d;
    if (i >= 0 && j >= 0 && j < fs.length) [fs[i], fs[j]] = [fs[j], fs[i]];
    return r;
  });
  const deleteField = (sid: string, fid: string) => { apply((r) => { const s = r.sections.find((x) => x.id === sid); if (s) s.fields = s.fields.filter((f) => f.id !== fid); return r; }); setSelection({ sectionId: sid }); };
  const addParam = () => patchReport((r) => {
    const used = new Set((r.params ?? []).map((p) => p.id));
    let n = 1; while (used.has(`param${n}`)) n++;
    r.params = [...(r.params ?? []), { id: `param${n}`, label: "新しい条件" }];
  });
  const patchParam = (i: number, patch: Partial<ReportParam>) => patchReport((r) => {
    const p = r.params?.[i];
    if (p) for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "" || v === false) delete (p as unknown as Record<string, unknown>)[k]; else (p as unknown as Record<string, unknown>)[k] = v; }
  });
  const removeParam = (i: number) => patchReport((r) => { r.params?.splice(i, 1); if (!r.params?.length) delete r.params; });

  // ── 見本図の操作 ──
  const onPaperClick = (e: React.MouseEvent) => {
    const el = e.target as Element;
    const f = el.closest("[data-field]"), s = el.closest("[data-section]");
    if (f && s) setSelection({ sectionId: s.getAttribute("data-section") as string, fieldId: f.getAttribute("data-field") as string });
    else if (s) setSelection({ sectionId: s.getAttribute("data-section") as string });
    else setSelection(null);
  };
  // 用紙の見本の項目は、同じ部の中でドラッグして並べ替えられる (項目の draggable は見本の HTML 側で付く)
  const paperRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ sid: string; fid: string } | null>(null);
  const clearDropMarks = () => paperRef.current?.querySelectorAll(".rpe-drop-before, .rpe-drop-after").forEach((el) => el.classList.remove("rpe-drop-before", "rpe-drop-after"));
  const dropTarget = (e: React.DragEvent) => {
    const el = (e.target as Element).closest?.("[data-field][data-section]");
    const drag = dragRef.current;
    if (!el || !drag || el.getAttribute("data-section") !== drag.sid || el.getAttribute("data-field") === drag.fid) return null;
    return el;
  };
  const onPaperDragStart = (e: React.DragEvent) => {
    const el = (e.target as Element).closest?.("[data-field][data-section]");
    if (!el) return;
    if (!editable) { e.preventDefault(); return; } // 閲覧のみ
    dragRef.current = { sid: el.getAttribute("data-section") as string, fid: el.getAttribute("data-field") as string };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragRef.current.fid);
  };
  const onPaperDragOver = (e: React.DragEvent) => {
    const el = dropTarget(e);
    clearDropMarks();
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    el.classList.add(e.clientX < rect.left + rect.width / 2 ? "rpe-drop-before" : "rpe-drop-after");
  };
  const onPaperDrop = (e: React.DragEvent) => {
    const el = dropTarget(e);
    const drag = dragRef.current;
    clearDropMarks();
    dragRef.current = null;
    if (!el || !drag) return;
    e.preventDefault();
    reorderFields(drag.sid, drag.fid, el.getAttribute("data-field") as string);
    setSelection({ sectionId: drag.sid, fieldId: drag.fid });
  };
  const onPaperDragEnd = () => { clearDropMarks(); dragRef.current = null; };
  const onPaperKey = (e: React.KeyboardEvent) => {
    const el = e.target as Element;
    const f = el.closest("[data-field]"), s = el.closest("[data-section]");
    if (f && s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelection({ sectionId: s.getAttribute("data-section") as string, fieldId: f.getAttribute("data-field") as string }); }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
    // 元に戻す / やり直し / 保存は useEditableDocument が受け持つ
    if ((e.key === "Delete" || e.key === "Backspace") && section && field && editable) { e.preventDefault(); deleteField(section.id, field.id); }
  };

  if (missing) {
    return (
      <div className="bfe-empty" data-testid="report-missing">
        <p>帳票「{reportId}」が見つかりません。</p>
        <button type="button" className="bfe-btn" onClick={() => navigate(wsPath("/report/list"))}>一覧へ戻る</button>
      </div>
    );
  }
  if (!report || sessionLoading) return <div className="bfe-empty"><p>読み込み中…</p></div>;

  const counts = { error: issues.filter((i) => i.severity === "error").length, warning: issues.filter((i) => i.severity === "warning").length };
  const csv = report.output?.format === "csv";

  return (
    <div className={`bfe rpe${editable ? "" : " bfe-readonly"}`} data-testid="report-editor" tabIndex={-1} onKeyDown={onKeyDown}>
      <EditSessionChrome {...chrome} />
      <div className="bfe-bar">
        <input className="bfe-title" value={report.name} disabled={!editable} onChange={(e) => patchReport((r) => { r.name = e.target.value; })} aria-label="帳票名" data-testid="rp-name" />
        <code className="bfe-id">{report.id}</code>
        {dirty && <span className="bfe-dirty" data-testid="rp-dirty">未保存</span>}
        <span className="bfe-spacer" />
        <button type="button" className="bfe-btn" onClick={undo} disabled={!editable || !canUndo} title="元に戻す (Ctrl+Z)" aria-label="元に戻す"><i className="bi bi-arrow-counterclockwise" /></button>
        <button type="button" className="bfe-btn" onClick={redo} disabled={!editable || !canRedo} title="やり直す (Ctrl+Y)" aria-label="やり直す"><i className="bi bi-arrow-clockwise" /></button>
        <EditSessionDropdown
          resourceType="report"
          resourceId={report.id}
          currentMode={mode}
          currentSessionId={sessionId}
          onStartEditing={() => { void chrome.onStartEditing(); }}
          onViewerAttached={syncSessionToUrl}
          onAttachAsView={attach}
          onTakeOver={takeOver}
        />
      </div>
      {notice && <p className="bfe-notice" role="status" data-testid="rp-notice">{notice} <button type="button" className="bfe-link" onClick={() => setNotice(null)}>閉じる</button></p>}

      <div className="bfe-body">
        {/* 左: 基本設定と部 */}
        <aside className="bfe-left" aria-label="基本設定と部">
          <fieldset className="bfe-fieldset" disabled={!editable}>
          <section className="bfe-form">
            <h4>出力</h4>
            <label className="bfe-field"><span>形式</span>
              <select value={report.output?.format ?? "pdf"} onChange={(e) => patchReport((r) => { r.output = { ...r.output, format: e.target.value as never }; })} data-testid="rp-format">
                {(Object.keys(REPORT_FORMAT_LABELS) as Array<keyof typeof REPORT_FORMAT_LABELS>).map((k) => <option key={k} value={k}>{REPORT_FORMAT_LABELS[k]}</option>)}
              </select>
            </label>
            {!csv && (
              <div className="bfe-row2">
                <label className="bfe-field"><span>用紙</span>
                  <select value={report.output?.paper ?? "A4"} onChange={(e) => patchReport((r) => { r.output = { ...r.output, paper: e.target.value as never }; })} data-testid="rp-paper">
                    {["A4", "A3", "B4", "B5", "letter"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="bfe-field"><span>向き</span>
                  <select value={report.output?.orientation ?? "portrait"} onChange={(e) => patchReport((r) => { r.output = { ...r.output, orientation: e.target.value as never }; })} data-testid="rp-orientation">
                    <option value="portrait">縦</option><option value="landscape">横</option>
                  </select>
                </label>
              </div>
            )}
          </section>
          <section className="bfe-form">
            <h4>出力契機</h4>
            <label className="bfe-field"><span>種類</span>
              <select value={report.trigger?.kind ?? ""} onChange={(e) => patchReport((r) => { r.trigger = { ...r.trigger, kind: (e.target.value || undefined) as never }; })} data-testid="rp-trigger-kind">
                <option value="">(未設定)</option><option value="screen">画面の操作</option><option value="batch">バッチ・定期</option><option value="api">外部からの要求</option>
              </select>
            </label>
            <label className="bfe-field"><span>画面</span>
              <select value={report.trigger?.screenRef ?? ""} onChange={(e) => patchReport((r) => { r.trigger = { ...r.trigger, screenRef: e.target.value || undefined }; })} data-testid="rp-trigger-screen">
                <option value="">(なし)</option>
                {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {report.trigger?.screenRef && !screens.some((s) => s.id === report.trigger?.screenRef) && <option value={report.trigger.screenRef}>{report.trigger.screenRef} (存在しない)</option>}
              </select>
            </label>
            <label className="bfe-field"><span>処理フロー</span>
              <select value={report.trigger?.processFlowRef ?? ""} onChange={(e) => patchReport((r) => { r.trigger = { ...r.trigger, processFlowRef: e.target.value || undefined }; })} data-testid="rp-trigger-flow">
                <option value="">(なし)</option>
                {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                {report.trigger?.processFlowRef && !flows.some((f) => f.id === report.trigger?.processFlowRef) && <option value={report.trigger.processFlowRef}>{report.trigger.processFlowRef} (存在しない)</option>}
              </select>
            </label>
            <label className="bfe-field"><span>契機の説明</span><input value={report.trigger?.description ?? ""} onChange={(e) => patchReport((r) => { r.trigger = { ...r.trigger, description: e.target.value || undefined }; })} placeholder="例: 注文完了画面の「納品書を印刷」" /></label>
          </section>
          <section>
            <h4>出力条件 <small>{report.params?.length ?? 0}</small></h4>
            {(report.params ?? []).map((p, i) => (
              <div className="rpe-param" key={i}>
                <input value={p.label} onChange={(e) => patchParam(i, { label: e.target.value })} aria-label="条件の名前" data-testid={`rp-param-label-${i}`} />
                <input value={p.id} onChange={(e) => patchParam(i, { id: e.target.value })} aria-label="条件の ID" className="rpe-mono" />
                <label className="rpe-check"><input type="checkbox" checked={!!p.required} onChange={(e) => patchParam(i, { required: e.target.checked })} /> 必須</label>
                <button type="button" className="bfe-mini-btn" onClick={() => removeParam(i)} aria-label="この条件を削除"><i className="bi bi-x-lg" /></button>
              </div>
            ))}
            <button type="button" className="bfe-btn bfe-btn-dashed" onClick={addParam} data-testid="rp-add-param"><i className="bi bi-plus-lg" /> 条件を追加</button>
          </section>
          </fieldset>
          <section>
            <h4>部 <small>{report.sections.length}</small></h4>
            <SortableList className="bfe-list" testId="rp-section-list" ids={report.sections.map((s) => s.id)} onReorder={reorderSections} disabled={!editable}>
              {report.sections.map((s, i) => (
                <SortableRow key={s.id} id={s.id} disabled={!editable} label={REPORT_SECTION_LABELS[s.kind]} className={selection?.sectionId === s.id && !selection.fieldId ? "bfe-sel" : ""}>
                  <button type="button" className="bfe-row" onClick={() => setSelection({ sectionId: s.id })} data-testid={`rp-list-section-${s.id}`}>
                    <span>{REPORT_SECTION_LABELS[s.kind]}{s.name && s.name !== REPORT_SECTION_LABELS[s.kind] ? `: ${s.name}` : ""}</span>
                    <small>{s.fields.length}</small>
                  </button>
                  <span className="bfe-mini">
                    <button type="button" onClick={() => moveSection(s.id, -1)} disabled={!editable || i === 0} aria-label="上へ"><i className="bi bi-chevron-up" /></button>
                    <button type="button" onClick={() => moveSection(s.id, 1)} disabled={!editable || i === report.sections.length - 1} aria-label="下へ"><i className="bi bi-chevron-down" /></button>
                  </span>
                </SortableRow>
              ))}
            </SortableList>
            <label className="bfe-field"><span>部を追加</span>
              <select value="" disabled={!editable} onChange={(e) => { if (e.target.value) addSection(e.target.value as ReportSectionKind); }} data-testid="rp-add-section">
                <option value="">種類を選ぶ…</option>
                {SECTION_KINDS.map((k) => <option key={k} value={k}>{REPORT_SECTION_LABELS[k]}</option>)}
              </select>
            </label>
          </section>
        </aside>

        {/* 中央: 用紙の見本 */}
        <main className="bfe-center">
          <div className="rpe-stage">
            <div ref={paperRef} className="rpe-paper-wrap" onClick={onPaperClick} onKeyDown={onPaperKey} onDragStart={onPaperDragStart} onDragOver={onPaperDragOver} onDrop={onPaperDrop} onDragEnd={onPaperDragEnd} data-testid="rp-paper-view" data-theme-audit-skip dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          <p className="bfe-hint">用紙の図は、項目の並びと幅から描いた見本です (実際の出力ではありません)。</p>
          <section className="bfe-issues" aria-label="要確認">
            <h4>要確認 <small>{counts.error ? `エラー ${counts.error} ` : ""}{counts.warning ? `警告 ${counts.warning}` : ""}{!counts.error && !counts.warning ? "なし" : ""}</small></h4>
            {issues.filter((i) => i.severity !== "info").length > 0 && (
              <ul>
                {issues.filter((i) => i.severity !== "info").map((i, k) => (
                  <li key={k} className={`bfe-issue bfe-issue-${i.severity}`}>
                    <button type="button" className="bfe-link" onClick={() => i.sectionId && setSelection({ sectionId: i.sectionId, fieldId: i.fieldId })} data-testid="rp-issue">{i.message}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        {/* 右: 設定 */}
        <aside className="bfe-right" aria-label="設定" data-testid="rp-inspector">
          <fieldset className="bfe-fieldset" disabled={!editable}>
          {section && field ? (
            <FieldInspector
              section={section} field={field} tables={tables} params={report.params ?? []}
              onPatch={(p) => patchField(section.id, field.id, p)}
              onMove={(d) => moveField(section.id, field.id, d)}
              onDelete={() => deleteField(section.id, field.id)}
              onBack={() => setSelection({ sectionId: section.id })}
            />
          ) : section ? (
            <SectionInspector
              section={section} tables={tables}
              onPatch={(p) => patchSection(section.id, p)}
              onAddField={(k) => addField(section.id, k)}
              onSelectField={(fid) => setSelection({ sectionId: section.id, fieldId: fid })}
              onDelete={() => deleteSection(section.id)}
            />
          ) : (
            <section className="bfe-form">
              <h4>帳票</h4>
              <label className="bfe-field"><span>説明</span><textarea rows={5} value={report.description ?? ""} onChange={(e) => patchReport((r) => { if (e.target.value) r.description = e.target.value; else delete r.description; })} data-testid="rp-description" /></label>
              <label className="bfe-field"><span>成熟度</span>
                <select value={report.maturity ?? ""} onChange={(e) => patchReport((r) => { if (e.target.value) r.maturity = e.target.value as Report["maturity"]; else delete r.maturity; })}>
                  <option value="">(未設定)</option><option value="draft">作成中</option><option value="provisional">レビュー中</option><option value="committed">確定</option>
                </select>
              </label>
              <p className="bfe-hint">見本図の部や項目、左の部の一覧を選ぶと、ここで設定できます。</p>
            </section>
          )}
          </fieldset>
        </aside>
      </div>
    </div>
  );
}

/** データの出どころ: 出力条件・テーブルの列から選ぶ。式などは直接入力 */
function SourcePicker(props: { value: string; tables: TableOpt[]; params: ReportParam[]; onChange: (v: string) => void; testId?: string }) {
  const known = new Set([...props.params.map((p) => `@param.${p.id}`), ...props.tables.flatMap((t) => t.columns.map((c) => `${t.id}.${c.physicalName}`))]);
  return (
    <div className="rpe-source">
      <select value={known.has(props.value) ? props.value : ""} onChange={(e) => props.onChange(e.target.value)} data-testid={props.testId}>
        <option value="">(選ぶ)</option>
        {props.params.length > 0 && (
          <optgroup label="出力条件">{props.params.map((p) => <option key={p.id} value={`@param.${p.id}`}>{p.label}</option>)}</optgroup>
        )}
        {props.tables.map((t) => (
          <optgroup key={t.id} label={t.name}>{t.columns.map((c) => <option key={c.physicalName} value={`${t.id}.${c.physicalName}`}>{c.name} ({c.physicalName})</option>)}</optgroup>
        ))}
      </select>
      <input className="rpe-mono" value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder="例: order.order_number" aria-label="出どころ (直接入力)" />
    </div>
  );
}

function SectionInspector(props: {
  section: ReportSection; tables: TableOpt[];
  onPatch: (p: Partial<ReportSection>) => void; onAddField: (k?: ReportFieldKind) => void; onSelectField: (id: string) => void; onDelete: () => void;
}) {
  const { section } = props;
  const grouped = section.kind === "groupHeader" || section.kind === "groupFooter";
  return (
    <section className="bfe-form" data-testid="rp-section-inspector">
      <h4>{REPORT_SECTION_LABELS[section.kind]} <code>{section.id}</code></h4>
      <label className="bfe-field"><span>名前</span><input value={section.name ?? ""} onChange={(e) => props.onPatch({ name: e.target.value })} data-testid="rp-section-name" /></label>
      {grouped && (
        <div className="bfe-field"><span>グループ化する項目</span>
          <SourcePicker value={section.groupBy ?? ""} tables={props.tables} params={[]} onChange={(v) => props.onPatch({ groupBy: v })} testId="rp-section-groupby" />
        </div>
      )}
      <div className="bfe-next">
        <h5>項目 <small>{section.fields.length}</small></h5>
        <ul className="bfe-list">
          {section.fields.map((f) => (
            <li key={f.id}><button type="button" className="bfe-row" onClick={() => props.onSelectField(f.id)} data-testid={`rp-list-field-${f.id}`}><span>{f.label || f.id}</span><small>{REPORT_FIELD_KIND_LABELS[f.kind]}</small></button></li>
          ))}
        </ul>
        <div className="bfe-btn-row">
          <button type="button" className="bfe-btn bfe-btn-dashed" onClick={() => props.onAddField()} data-testid="rp-add-field"><i className="bi bi-plus-lg" /> 項目を追加</button>
        </div>
      </div>
      <button type="button" className="bfe-btn bfe-btn-danger" onClick={props.onDelete} data-testid="rp-section-delete"><i className="bi bi-trash" /> この部を削除</button>
    </section>
  );
}

function FieldInspector(props: {
  section: ReportSection; field: ReportField; tables: TableOpt[]; params: ReportParam[];
  onPatch: (p: Partial<ReportField>) => void; onMove: (d: -1 | 1) => void; onDelete: () => void; onBack: () => void;
}) {
  const { field, section } = props;
  const needsSource = field.kind === "field" || field.kind === "aggregate";
  const idx = section.fields.findIndex((f) => f.id === field.id);
  return (
    <section className="bfe-form" data-testid="rp-field-inspector">
      <h4><button type="button" className="bfe-link" onClick={props.onBack}>{REPORT_SECTION_LABELS[section.kind]}</button> › 項目 <code>{field.id}</code></h4>
      <label className="bfe-field"><span>種類</span>
        <select value={field.kind} onChange={(e) => props.onPatch({ kind: e.target.value as ReportFieldKind, ...(e.target.value === "aggregate" && !field.aggregate ? { aggregate: "sum" as ReportAggregate } : {}) })} data-testid="rp-field-kind">
          {FIELD_KINDS.map((k) => <option key={k} value={k}>{REPORT_FIELD_KIND_LABELS[k]}</option>)}
        </select>
      </label>
      <label className="bfe-field"><span>{field.kind === "text" ? "文言" : "見出し・名前"}</span><input value={field.label ?? ""} onChange={(e) => props.onPatch({ label: e.target.value })} data-testid="rp-field-label" /></label>
      {needsSource && (
        <div className="bfe-field"><span>データの出どころ</span>
          <SourcePicker value={field.source ?? ""} tables={props.tables} params={props.params} onChange={(v) => props.onPatch({ source: v })} testId="rp-field-source" />
        </div>
      )}
      {field.kind === "aggregate" && (
        <label className="bfe-field"><span>集計の種類</span>
          <select value={field.aggregate ?? ""} onChange={(e) => props.onPatch({ aggregate: (e.target.value || undefined) as ReportAggregate })} data-testid="rp-field-aggregate">
            <option value="">(選ぶ)</option>
            {(Object.keys(REPORT_AGGREGATE_LABELS) as ReportAggregate[]).map((k) => <option key={k} value={k}>{REPORT_AGGREGATE_LABELS[k]}</option>)}
          </select>
        </label>
      )}
      <div className="bfe-row2">
        <label className="bfe-field"><span>書式</span><input value={field.format ?? ""} onChange={(e) => props.onPatch({ format: e.target.value })} placeholder="#,##0 / ¥#,##0 / YYYY/MM/DD" data-testid="rp-field-format" /></label>
        <label className="bfe-field"><span>揃え</span>
          <select value={field.align ?? "left"} onChange={(e) => props.onPatch({ align: e.target.value === "left" ? undefined : (e.target.value as ReportField["align"]) })} data-testid="rp-field-align">
            <option value="left">左</option><option value="center">中央</option><option value="right">右</option>
          </select>
        </label>
      </div>
      <label className="bfe-field"><span>幅 % (空欄は自動)</span>
        <input type="number" min={1} max={100} step={1} value={field.width ?? ""} onChange={(e) => props.onPatch({ width: e.target.value === "" ? undefined : Number(e.target.value) })} data-testid="rp-field-width" />
      </label>
      <label className="bfe-field"><span>説明</span><textarea rows={2} value={field.description ?? ""} onChange={(e) => props.onPatch({ description: e.target.value })} /></label>
      <div className="bfe-btn-row">
        <button type="button" className="bfe-btn" onClick={() => props.onMove(-1)} disabled={idx <= 0} data-testid="rp-field-left"><i className="bi bi-arrow-left" /> 左へ</button>
        <button type="button" className="bfe-btn" onClick={() => props.onMove(1)} disabled={idx >= section.fields.length - 1} data-testid="rp-field-right">右へ <i className="bi bi-arrow-right" /></button>
        <button type="button" className="bfe-btn bfe-btn-danger" onClick={props.onDelete} data-testid="rp-field-delete"><i className="bi bi-trash" /> 削除</button>
      </div>
    </section>
  );
}
