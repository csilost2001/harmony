/**
 * 業務フロー一覧 (/business-flow/list)。
 *
 * 一覧の操作 (選択・キーボード・ソート) は docs/spec/list-common.md の共通部品に従う。
 * 新規作成・複製・削除ができる。編集は /business-flow/edit/:id (BusinessFlowEditor)。
 * 仕様: docs/spec/business-flow.md
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { validateBusinessFlow, type BusinessFlow } from "@harmony/shared";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { mcpBridge } from "../../mcp/mcpBridge";
import { buildDefaultBusinessFlow, deleteBusinessFlow, saveBusinessFlow, useBusinessFlows } from "../../store/businessFlowStore";
import { DataList, type DataListColumn } from "../common/DataList";
import { EntityIdInput, type EntityIdValidationState } from "../common/EntityIdInput";
import { useListSelection } from "../../hooks/useListSelection";
import { useListSort } from "../../hooks/useListSort";
import { makeDuplicatedEntityId } from "../../utils/entityIdSuggestion";
import "../../styles/businessFlow.css";

const MATURITY: Record<string, string> = { draft: "作成中", provisional: "レビュー中", committed: "確定" };

export function BusinessFlowListView() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const { flows, loaded, reload } = useBusinessFlows();
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

  const sortAccessor = useCallback((f: BusinessFlow, key: string): string | number => {
    switch (key) {
      case "name": return f.name;
      case "id": return f.id;
      case "steps": return f.steps.length;
      case "updatedAt": return f.updatedAt ?? "";
      default: return "";
    }
  }, []);
  const sort = useListSort(filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (f) => f.id);

  const open = useCallback((f: BusinessFlow) => navigate(wsPath(`/business-flow/edit/${encodeURIComponent(f.id)}`)), [navigate, wsPath]);

  const create = async () => {
    if (addValidation.isInvalid || !addName.trim()) return;
    await saveBusinessFlow(buildDefaultBusinessFlow(addId, addName.trim()));
    setShowAdd(false); setAddId(""); setAddName("");
    navigate(wsPath(`/business-flow/edit/${encodeURIComponent(addId)}`));
  };

  const duplicate = async (items: BusinessFlow[]) => {
    const taken = new Set(flows.map((f) => f.id));
    for (const f of items) {
      const id = makeDuplicatedEntityId(f.id, taken);
      taken.add(id);
      const { createdAt: _c, updatedAt: _u, ...rest } = f;
      void _c; void _u;
      await saveBusinessFlow({ ...rest, id, name: `${f.name} (コピー)` });
    }
    setMessage(`${items.length} 件を複製しました`);
  };

  const remove = async (items: BusinessFlow[]) => {
    if (!items.length) return;
    if (!window.confirm(`業務フロー ${items.map((f) => `「${f.name}」`).join("、")} を削除します。元に戻せません。よろしいですか?`)) return;
    for (const f of items) await deleteBusinessFlow(f.id);
    selection.clearSelection();
    setMessage(`${items.length} 件を削除しました`);
  };

  const columns = useMemo<DataListColumn<BusinessFlow>[]>(() => [
    { key: "name", header: "名前", sortable: true, sortAccessor: (f) => f.name, render: (f) => <span className="bfl-name">{f.name}</span> },
    { key: "id", header: "ID", sortable: true, sortAccessor: (f) => f.id, render: (f) => <code>{f.id}</code> },
    { key: "lanes", header: "レーン", width: "80px", align: "right", render: (f) => f.lanes.length },
    { key: "steps", header: "工程", width: "80px", align: "right", sortable: true, sortAccessor: (f) => f.steps.length, render: (f) => f.steps.length },
    {
      key: "issues", header: "要確認", width: "90px", align: "right",
      render: (f) => {
        const n = validateBusinessFlow(f).filter((i) => i.severity !== "info").length;
        return n ? <span className="bfl-issues">{n}</span> : <span className="bfl-ok">なし</span>;
      },
    },
    { key: "maturity", header: "成熟度", width: "100px", render: (f) => MATURITY[f.maturity ?? ""] ?? "" },
    { key: "updatedAt", header: "更新", width: "110px", sortable: true, sortAccessor: (f) => f.updatedAt ?? "", render: (f) => (f.updatedAt ? new Date(f.updatedAt).toLocaleDateString("ja-JP") : "") },
  ], []);

  const selected = flows.filter((f) => selection.selectedIds.has(f.id));

  return (
    <div className="bfl" data-testid="business-flow-list">
      <div className="bfl-head">
        <h2><i className="bi bi-diagram-2" /> 業務フロー</h2>
        <input className="bfl-search" type="search" placeholder="名前・ID で絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="絞り込み" />
        <div className="bfl-actions">
          <button type="button" className="bfe-btn bfe-btn-primary" onClick={() => setShowAdd(true)} data-testid="bf-add"><i className="bi bi-plus-lg" /> 業務フロー追加</button>
          <button type="button" className="bfe-btn" disabled={!selected.length} onClick={() => duplicate(selected)} data-testid="bf-duplicate"><i className="bi bi-files" /> 複製</button>
          <button type="button" className="bfe-btn bfe-btn-danger" disabled={!selected.length} onClick={() => remove(selected)} data-testid="bf-delete"><i className="bi bi-trash" /> 削除</button>
        </div>
      </div>
      {message && <p className="bfl-message" role="status">{message}</p>}
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
          ? <p>{query ? "該当する業務フローがありません" : "業務フローがまだありません。「業務フロー追加」から作成してください。"}</p>
          : <p>読み込み中…</p>}
      />
      {showAdd && (
        <div className="bfe-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="bfe-modal" role="dialog" aria-label="業務フロー追加" onClick={(e) => e.stopPropagation()}>
            <h3>業務フロー追加</h3>
            <label className="bfe-field">
              <span>名前</span>
              <input autoFocus value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="例: 注文から出荷まで" data-testid="bf-add-name" />
            </label>
            <div className="bfe-field">
              <span>ID (kebab-case)</span>
              <EntityIdInput value={addId} onChange={setAddId} name={addName} existingIds={flows.map((f) => f.id)} entityLabel="業務フロー" onValidationChange={setAddValidation} onEnter={create} inputId="bf-add-id" />
            </div>
            <div className="bfe-modal-actions">
              <button type="button" className="bfe-btn" onClick={() => setShowAdd(false)}>キャンセル</button>
              <button type="button" className="bfe-btn bfe-btn-primary" disabled={addValidation.isInvalid || !addName.trim()} onClick={create} data-testid="bf-add-submit">作成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
