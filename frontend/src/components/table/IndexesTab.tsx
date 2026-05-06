import { useState } from "react";
import type { Table, Index, LocalId, PhysicalName } from "../../types/v3";
import { addIndex, removeIndex } from "../../store/tableStore";

type IndexMethod = "btree" | "hash" | "gin" | "gist";
const INDEX_METHODS: IndexMethod[] = ["btree", "hash", "gin", "gist"];

interface Props {
  table: Table;
  update: (fn: (t: Table) => void) => void;
}

export function IndexesTab({ table, update }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const indexes = table.indexes ?? [];

  const handleAdd = () => {
    let newId: string = "";
    update((t) => {
      const idx = addIndex(t);
      newId = idx.id;
    });
    setTimeout(() => setEditingId(newId), 0);
  };

  const handleDelete = (id: string) => {
    update((t) => removeIndex(t, id));
    if (editingId === id) setEditingId(null);
  };

  const handleUpdate = (id: string, patch: Partial<Index>) => {
    update((t) => {
      const idx = (t.indexes ?? []).find((i) => i.id === id);
      if (idx) Object.assign(idx, patch);
    });
  };

  return (
    <div className="indexes-tab2">
      <div className="indexes-toolbar2">
        <span className="indexes-count">
          {indexes.length === 0 ? "インデックスがまだありません" : `${indexes.length} 件`}
        </span>
        <button className="tbl-btn tbl-btn-primary" onClick={handleAdd}>
          <i className="bi bi-plus-lg" /> 追加
        </button>
      </div>

      {indexes.length === 0 ? (
        <div className="indexes-empty2">
          <i className="bi bi-lightning indexes-empty-icon" />
          <p>インデックスを追加すると DDL プレビューに <code>CREATE INDEX</code> として出力されます。</p>
        </div>
      ) : (
        <div className="indexes-list2">
          {indexes.map((idx) =>
            editingId === idx.id ? (
              <IndexEditorCard
                key={idx.id}
                idx={idx}
                table={table}
                onUpdate={(patch) => handleUpdate(idx.id, patch)}
                onClose={() => setEditingId(null)}
                onDelete={() => handleDelete(idx.id)}
              />
            ) : (
              <IndexRow
                key={idx.id}
                idx={idx}
                table={table}
                onEdit={() => setEditingId(idx.id)}
                onDelete={() => handleDelete(idx.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function colPhysical(table: Table, columnId: string): string {
  return table.columns.find((c) => c.id === columnId)?.physicalName ?? columnId;
}

// ── 一覧行 ────────────────────────────────────────────────────────────────────

function IndexRow({
  idx, table, onEdit, onDelete,
}: {
  idx: Index;
  table: Table;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const colSummary = idx.columns.length > 0
    ? idx.columns.map((ic) => `${colPhysical(table, ic.columnId)}${ic.order === "desc" ? " DESC" : ""}`).join(", ")
    : "(列未選択)";

  return (
    <div className="index-row2">
      <div className="index-row-main">
        {idx.unique && <span className="index-unique-badge">UNIQUE</span>}
        {idx.method && idx.method !== "btree" && (
          <span className="index-method-badge">{idx.method.toUpperCase()}</span>
        )}
        <code className="index-row-id">{idx.physicalName}</code>
        {idx.description && <span className="index-row-desc">{idx.description}</span>}
      </div>
      <div className="index-row-summary">
        <span>列: {colSummary}</span>
        {idx.where && <span className="index-row-where">WHERE {idx.where}</span>}
      </div>
      <div className="index-row-actions">
        <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={onEdit}>
          <i className="bi bi-pencil" /> 編集
        </button>
        <button className="tbl-btn tbl-btn-ghost tbl-btn-sm danger" onClick={onDelete}>
          <i className="bi bi-trash" />
        </button>
      </div>
    </div>
  );
}

// ── インライン編集カード ──────────────────────────────────────────────────────

function IndexEditorCard({
  idx, table, onUpdate, onClose, onDelete,
}: {
  idx: Index;
  table: Table;
  onUpdate: (patch: Partial<Index>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const handleColIdChange = (i: number, columnId: string) => {
    const cols = [...idx.columns];
    cols[i] = { ...cols[i], columnId: columnId as LocalId };
    onUpdate({ columns: cols });
  };

  const handleColOrderChange = (i: number, order: "asc" | "desc") => {
    const cols = [...idx.columns];
    cols[i] = { ...cols[i], order };
    onUpdate({ columns: cols });
  };

  const handleColRemove = (i: number) => {
    const cols = idx.columns.filter((_, j) => j !== i);
    onUpdate({ columns: cols });
  };

  const handleColAdd = () => {
    onUpdate({ columns: [...idx.columns, { columnId: "" as LocalId }] });
  };

  return (
    <div className="index-editor-card">
      <div className="index-editor-header">
        <div className="index-editor-name-wrap">
          <label className="index-editor-label">インデックス物理名</label>
          <input
            className="index-name-input2"
            value={idx.physicalName}
            onChange={(e) => onUpdate({ physicalName: e.target.value as PhysicalName })}
            placeholder="idx_tablename_column"
          />
        </div>
        <button className="tbl-btn-icon" onClick={onClose} title="閉じる">
          <i className="bi bi-x-lg" />
        </button>
      </div>

      <div className="index-editor-body">
        {/* Columns */}
        <div className="index-editor-field">
          <span>対象列</span>
          <div className="index-columns-list">
            {idx.columns.map((ic, i) => (
              <div key={i} className="index-col-row">
                <select
                  value={ic.columnId}
                  onChange={(e) => handleColIdChange(i, e.target.value)}
                  className="index-col-select"
                >
                  <option value="">列を選択...</option>
                  {table.columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.physicalName}</option>
                  ))}
                </select>
                <select
                  value={ic.order ?? "asc"}
                  onChange={(e) => handleColOrderChange(i, e.target.value as "asc" | "desc")}
                  className="index-order-select"
                >
                  <option value="asc">ASC</option>
                  <option value="desc">DESC</option>
                </select>
                <button
                  className="tbl-btn-icon"
                  onClick={() => handleColRemove(i)}
                  title="削除"
                >
                  <i className="bi bi-x" />
                </button>
              </div>
            ))}
            <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={handleColAdd}>
              <i className="bi bi-plus" /> 列を追加
            </button>
          </div>
        </div>

        {/* Flags */}
        <div className="index-editor-flags">
          <label className="column-flag-label">
            <input
              type="checkbox"
              checked={idx.unique ?? false}
              onChange={(e) => onUpdate({ unique: e.target.checked })}
            />
            UNIQUE インデックス
          </label>
        </div>

        {/* Method */}
        <label className="index-editor-field">
          <span>インデックス方式 (PostgreSQL)</span>
          <select
            value={idx.method ?? "btree"}
            onChange={(e) => onUpdate({ method: e.target.value as IndexMethod })}
            className="index-method-select"
          >
            {INDEX_METHODS.map((m) => (
              <option key={m} value={m}>{m.toUpperCase()}</option>
            ))}
          </select>
        </label>

        {/* WHERE */}
        <label className="index-editor-field">
          <span>部分インデックス条件 (WHERE) — 省略可</span>
          <input
            type="text"
            value={idx.where ?? ""}
            onChange={(e) => onUpdate({ where: e.target.value || undefined })}
            placeholder="status = 'active'"
            className="index-where-input"
          />
        </label>

        {/* Description */}
        <label className="index-editor-field">
          <span>目的 (任意)</span>
          <input
            type="text"
            value={idx.description ?? ""}
            onChange={(e) => onUpdate({ description: e.target.value || undefined })}
            placeholder="日付範囲検索の高速化"
          />
        </label>
      </div>

      <div className="index-editor-footer">
        <button className="tbl-btn tbl-btn-ghost tbl-btn-sm danger" onClick={onDelete}>
          <i className="bi bi-trash" /> 削除
        </button>
        <button className="tbl-btn tbl-btn-primary tbl-btn-sm" onClick={onClose}>
          完了
        </button>
      </div>
    </div>
  );
}
