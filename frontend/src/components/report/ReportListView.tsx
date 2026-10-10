/**
 * 帳票一覧 (/report/list)。
 *
 * 一覧の操作 (選択・キーボード・ソート) は docs/spec/list-common.md の共通部品に従う。
 * 新規作成・複製・削除ができる。編集は /report/edit/:id (ReportEditor)。
 * 仕様: docs/spec/report.md
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { REPORT_FORMAT_LABELS, validateReport, type Report } from "@harmony/shared";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { mcpBridge } from "../../mcp/mcpBridge";
import { buildDefaultReport, deleteReport, errorText, saveReport, useReports } from "../../store/reportStore";
import { DataList, type DataListColumn } from "../common/DataList";
import { EntityIdInput, type EntityIdValidationState } from "../common/EntityIdInput";
import { useListSelection } from "../../hooks/useListSelection";
import { useListSort } from "../../hooks/useListSort";
import { makeDuplicatedEntityId } from "../../utils/entityIdSuggestion";
import "../../styles/businessFlow.css";
import "../../styles/report.css";

const MATURITY: Record<string, string> = { draft: "作成中", provisional: "レビュー中", committed: "確定" };

export function ReportListView() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const { reports: flows, unreadable, loaded, reload } = useReports();
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addId, setAddId] = useState("");
  const [addName, setAddName] = useState("");
  const [addValidation, setAddValidation] = useState<EntityIdValidationState>({ isFormatValid: false, isUnique: true, isInvalid: true });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    const off = mcpBridge.onStatusChange((s) => { if (s === "connected") reload().catch(console.error); });
    return off;
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? flows.filter((f) => f.name.toLowerCase().includes(q) || f.id.includes(q)) : flows;
  }, [flows, query]);

  const sortAccessor = useCallback((f: Report, key: string): string | number => {
    switch (key) {
      case "name": return f.name;
      case "id": return f.id;
      case "steps": return f.sections.length;
      case "updatedAt": return f.updatedAt ?? "";
      default: return "";
    }
  }, []);
  const sort = useListSort(filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (f) => f.id);

  const open = useCallback((f: Report) => navigate(wsPath(`/report/edit/${encodeURIComponent(f.id)}`)), [navigate, wsPath]);

  const create = async () => {
    if (addValidation.isInvalid || !addName.trim()) return;
    try {
      await saveReport(buildDefaultReport(addId, addName.trim()), { createOnly: true });
    } catch (e) { setMessage(`作成できませんでした: ${errorText(e)}`); setShowAdd(false); reload().catch(console.error); return; }
    setShowAdd(false); setAddId(""); setAddName("");
    // 作成した直後は、自動で編集を始める (編集画面が受け取る)
    try { sessionStorage.setItem(`harmony-auto-edit:report:${addId}`, "1"); } catch { /* 使えなくても開くだけ */ }
    navigate(wsPath(`/report/edit/${encodeURIComponent(addId)}`));
  };

  const duplicate = async (items: Report[]) => {
    const taken = new Set(flows.map((f) => f.id));
    for (const f of items) {
      const id = makeDuplicatedEntityId(f.id, taken);
      taken.add(id);
      const { createdAt: _c, updatedAt: _u, ...rest } = f;
      void _c; void _u;
      try {
        await saveReport({ ...rest, id, name: `${f.name} (コピー)` }, { createOnly: true });
      } catch (e) { setMessage(`複製できませんでした: ${errorText(e)}`); reload().catch(console.error); return; }
    }
    setMessage(`${items.length} 件を複製しました`);
  };

  const remove = async (items: Report[]) => {
    if (!items.length) return;
    if (!window.confirm(`帳票 ${items.map((f) => `「${f.name}」`).join("、")} を削除します。元に戻せません。よろしいですか?`)) return;
    for (const f of items) await deleteReport(f.id);
    selection.clearSelection();
    setMessage(`${items.length} 件を削除しました`);
  };

  const columns = useMemo<DataListColumn<Report>[]>(() => [
    { key: "name", header: "名前", sortable: true, sortAccessor: (f) => f.name, render: (f) => <span className="bfl-name">{f.name}</span> },
    { key: "id", header: "ID", sortable: true, sortAccessor: (f) => f.id, render: (f) => <code>{f.id}</code> },
    { key: "output", header: "出力", width: "150px", render: (f) => `${REPORT_FORMAT_LABELS[f.output?.format ?? "pdf"]}${f.output?.format === "csv" ? "" : ` ${f.output?.paper ?? "A4"} ${f.output?.orientation === "landscape" ? "横" : "縦"}`}` },
    { key: "sections", header: "部", width: "60px", align: "right", render: (f) => f.sections.length },
    { key: "fields", header: "項目", width: "70px", align: "right", sortable: true, sortAccessor: (f) => f.sections.reduce((n, s) => n + s.fields.length, 0), render: (f) => f.sections.reduce((n, s) => n + s.fields.length, 0) },
    {
      key: "issues", header: "要確認", width: "90px", align: "right",
      render: (f) => {
        const n = validateReport(f).filter((i) => i.severity !== "info" && !/^unknown-/.test(i.code)).length;
        return n ? <span className="bfl-issues">{n}</span> : <span className="bfl-ok">なし</span>;
      },
    },
    { key: "maturity", header: "成熟度", width: "100px", render: (f) => MATURITY[f.maturity ?? ""] ?? "" },
    { key: "updatedAt", header: "更新", width: "110px", sortable: true, sortAccessor: (f) => f.updatedAt ?? "", render: (f) => (f.updatedAt ? new Date(f.updatedAt).toLocaleDateString("ja-JP") : "") },
  ], []);

  const selected = flows.filter((f) => selection.selectedIds.has(f.id));

  return (
    <div className="bfl" data-testid="report-list">
      <div className="bfl-head">
        <h2><i className="bi bi-file-earmark-text" /> 帳票</h2>
        <input className="bfl-search" type="search" placeholder="名前・ID で絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="絞り込み" />
        <div className="bfl-actions">
          <button type="button" className="bfe-btn bfe-btn-primary" onClick={() => setShowAdd(true)} data-testid="rp-add"><i className="bi bi-plus-lg" /> 帳票追加</button>
          <button type="button" className="bfe-btn" disabled={!selected.length} onClick={() => duplicate(selected)} data-testid="rp-duplicate"><i className="bi bi-files" /> 複製</button>
          <button type="button" className="bfe-btn bfe-btn-danger" disabled={!selected.length} onClick={() => remove(selected)} data-testid="rp-delete"><i className="bi bi-trash" /> 削除</button>
        </div>
      </div>
      {message && <p className="bfl-message" role="status">{message}</p>}
      {unreadable.length > 0 && (
        <p className="bfl-unreadable" role="alert" data-testid="unreadable-files">
          <i className="bi bi-exclamation-triangle" /> 読めない帳票のファイルがあります (JSON が壊れています): {unreadable.map((f) => <code key={f}>{f}</code>)}。ファイルを直すか、同じ ID で保存し直すと退避して置き換えます。
        </p>
      )}
      <DataList
        items={sort.sorted}
        columns={columns}
        getId={(f) => f.id}
        selection={selection}
        sort={sort}
        onActivate={open}
        onRowDelete={(f) => remove([f])}
        layout="list"
        showNumColumn
        variant="dark"
        className="bfl-data-list"
        emptyMessage={loaded
          ? <p>{query ? "該当する帳票がありません" : "帳票がまだありません。「帳票追加」から作成してください。"}</p>
          : <p>読み込み中…</p>}
      />
      {showAdd && (
        <div className="bfe-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="bfe-modal" role="dialog" aria-label="帳票追加" onClick={(e) => e.stopPropagation()}>
            <h3>帳票追加</h3>
            <label className="bfe-field">
              <span>名前</span>
              <input autoFocus value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="例: 納品書" data-testid="rp-add-name" />
            </label>
            <div className="bfe-field">
              <span>ID (kebab-case)</span>
              <EntityIdInput value={addId} onChange={setAddId} name={addName} existingIds={flows.map((f) => f.id)} entityLabel="帳票" onValidationChange={setAddValidation} onEnter={create} inputId="rp-add-id" />
            </div>
            <div className="bfe-modal-actions">
              <button type="button" className="bfe-btn" onClick={() => setShowAdd(false)}>キャンセル</button>
              <button type="button" className="bfe-btn bfe-btn-primary" disabled={addValidation.isInvalid || !addName.trim()} onClick={create} data-testid="rp-add-submit">作成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
