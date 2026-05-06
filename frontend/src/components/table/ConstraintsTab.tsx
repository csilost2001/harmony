import { useState } from "react";
import type {
  Table,
  Constraint,
  UniqueConstraint,
  CheckConstraint,
  ForeignKeyConstraint,
  FkAction,
  LocalId,
  TableId,
} from "../../types/v3";
import { addConstraint, removeConstraint } from "../../store/tableStore";

const FK_ACTIONS: FkAction[] = ["cascade", "setNull", "setDefault", "restrict", "noAction"];
const FK_ACTION_LABELS: Record<FkAction, string> = {
  cascade: "CASCADE",
  setNull: "SET NULL",
  setDefault: "SET DEFAULT",
  restrict: "RESTRICT",
  noAction: "NO ACTION",
};

interface Props {
  table: Table;
  update: (fn: (t: Table) => void) => void;
  allTables: Table[];
}

type ConstraintKind = "unique" | "check" | "foreignKey";

export function ConstraintsTab({ table, update, allTables }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const constraints = table.constraints ?? [];

  const handleAdd = (kind: ConstraintKind) => {
    setAddMenuOpen(false);
    let newId: string = "";
    update((t) => {
      const base = buildDefault(kind);
      const c = addConstraint(t, base);
      newId = c.id;
    });
    setTimeout(() => setEditingId(newId), 0);
  };

  const handleDelete = (id: string) => {
    update((t) => removeConstraint(t, id));
    if (editingId === id) setEditingId(null);
  };

  /**
   * 編集中の制約が schema 必須フィールドを満たしているか判定。
   * - unique: columnIds が 1 件以上
   * - check: expression が空でない
   * - foreignKey: referencedTableId が UUID 形式 + columnIds / referencedColumnIds が 1 件以上
   */
  const isConstraintValid = (c: Constraint): boolean => {
    if (c.kind === "unique") return c.columnIds.length > 0;
    if (c.kind === "check") return c.expression.trim().length > 0;
    // foreignKey
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    return c.columnIds.length > 0
      && uuidRe.test(c.referencedTableId)
      && c.referencedColumnIds.length > 0;
  };

  /** 編集を閉じる際、必須フィールドが空のままなら制約を自動削除 (#557 M-3 対応)。 */
  const handleCloseEditor = (id: string) => {
    const c = (table.constraints ?? []).find((x) => x.id === id);
    if (c && !isConstraintValid(c)) {
      update((t) => removeConstraint(t, id));
    }
    setEditingId(null);
  };

  const handleUpdate = (id: string, patch: Partial<Constraint>) => {
    update((t) => {
      const c = (t.constraints ?? []).find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    });
  };

  return (
    <div className="constraints-tab">
      <div className="constraints-toolbar">
        <span className="constraints-count">
          {constraints.length === 0
            ? "制約がまだありません"
            : `${constraints.length} 件`}
        </span>
        <div className="constraints-add-wrap">
          <button
            className="tbl-btn tbl-btn-primary"
            onClick={() => setAddMenuOpen((v) => !v)}
          >
            <i className="bi bi-plus-lg" /> 制約を追加
            <i className="bi bi-chevron-down" style={{ marginLeft: 4, fontSize: 11 }} />
          </button>
          {addMenuOpen && (
            <div className="constraints-add-menu" onMouseLeave={() => setAddMenuOpen(false)}>
              <button onClick={() => handleAdd("unique")}>
                <i className="bi bi-check2-square" /> UNIQUE
              </button>
              <button onClick={() => handleAdd("check")}>
                <i className="bi bi-shield-check" /> CHECK
              </button>
              <button onClick={() => handleAdd("foreignKey")}>
                <i className="bi bi-link-45deg" /> FOREIGN KEY
              </button>
            </div>
          )}
        </div>
      </div>

      {constraints.length === 0 ? (
        <div className="constraints-empty">
          <i className="bi bi-shield-check constraints-empty-icon" />
          <p>制約を追加すると DDL プレビューに <code>ALTER TABLE ... ADD CONSTRAINT</code> として出力されます。</p>
        </div>
      ) : (
        <div className="constraints-list">
          {constraints.map((c) =>
            editingId === c.id ? (
              <ConstraintEditor
                key={c.id}
                constraint={c}
                table={table}
                allTables={allTables}
                onUpdate={(patch) => handleUpdate(c.id, patch)}
                onClose={() => handleCloseEditor(c.id)}
                onDelete={() => handleDelete(c.id)}
              />
            ) : (
              <ConstraintRow
                key={c.id}
                constraint={c}
                table={table}
                allTables={allTables}
                onEdit={() => setEditingId(c.id)}
                onDelete={() => handleDelete(c.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ── 一覧行（折りたたみ状態） ─────────────────────────────────────────────────

function ConstraintRow({
  constraint, table, allTables, onEdit, onDelete,
}: {
  constraint: Constraint;
  table: Table;
  allTables: Table[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const badge = kindBadge(constraint.kind);
  const summary = constraintSummary(constraint, table, allTables);

  return (
    <div className="constraint-row">
      <div className="constraint-row-main">
        <span className={`constraint-kind-badge constraint-kind-badge--${constraint.kind}`}>{badge}</span>
        <code className="constraint-id">{constraint.physicalName ?? constraint.id}</code>
        {constraint.description && (
          <span className="constraint-desc-inline">{constraint.description}</span>
        )}
      </div>
      <div className="constraint-row-summary">{summary}</div>
      <div className="constraint-row-actions">
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

function ConstraintEditor({
  constraint, table, allTables, onUpdate, onClose, onDelete,
}: {
  constraint: Constraint;
  table: Table;
  allTables: Table[];
  onUpdate: (patch: Partial<Constraint>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="constraint-editor-card">
      <div className="constraint-editor-header">
        <span className={`constraint-kind-badge constraint-kind-badge--${constraint.kind}`}>
          {kindBadge(constraint.kind)}
        </span>
        <div className="constraint-editor-id-wrap">
          <label className="constraint-editor-label">制約物理名 (任意)</label>
          <input
            className="constraint-id-input"
            value={constraint.physicalName ?? ""}
            onChange={(e) =>
              onUpdate({ physicalName: (e.target.value || undefined) as never } as Partial<Constraint>)
            }
            placeholder="constraint_physical_name"
          />
        </div>
        <button className="tbl-btn-icon" onClick={onClose} title="閉じる">
          <i className="bi bi-x-lg" />
        </button>
      </div>

      <div className="constraint-editor-body">
        {constraint.kind === "unique" && (
          <UniqueEditor c={constraint} table={table} onUpdate={onUpdate} />
        )}
        {constraint.kind === "check" && (
          <CheckEditor c={constraint} onUpdate={onUpdate} />
        )}
        {constraint.kind === "foreignKey" && (
          <FkEditor c={constraint} table={table} allTables={allTables} onUpdate={onUpdate} />
        )}

        <label className="constraint-editor-field">
          <span>説明 (任意)</span>
          <input
            type="text"
            value={constraint.description ?? ""}
            onChange={(e) =>
              onUpdate({ description: e.target.value || undefined } as Partial<Constraint>)
            }
            placeholder="制約の目的・理由"
          />
        </label>
      </div>

      <div className="constraint-editor-footer">
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

// ── UNIQUE 編集 ───────────────────────────────────────────────────────────────

function UniqueEditor({
  c, table, onUpdate,
}: {
  c: UniqueConstraint;
  table: Table;
  onUpdate: (patch: Partial<Constraint>) => void;
}) {
  const toggle = (colId: LocalId) => {
    const cols = c.columnIds.includes(colId)
      ? c.columnIds.filter((x) => x !== colId)
      : [...c.columnIds, colId];
    onUpdate({ columnIds: cols } as Partial<UniqueConstraint>);
  };

  return (
    <div className="constraint-editor-field">
      <span>対象列 (1 つ以上選択)</span>
      <div className="constraint-col-chips">
        {table.columns.map((col) => (
          <label
            key={col.id}
            className={`constraint-col-chip${c.columnIds.includes(col.id) ? " selected" : ""}`}
          >
            <input
              type="checkbox"
              checked={c.columnIds.includes(col.id)}
              onChange={() => toggle(col.id)}
            />
            {col.physicalName}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── CHECK 編集 ────────────────────────────────────────────────────────────────

function CheckEditor({
  c, onUpdate,
}: {
  c: CheckConstraint;
  onUpdate: (patch: Partial<Constraint>) => void;
}) {
  return (
    <label className="constraint-editor-field">
      <span>SQL 式</span>
      <input
        type="text"
        value={c.expression}
        onChange={(e) => onUpdate({ expression: e.target.value } as Partial<CheckConstraint>)}
        placeholder="amount > 0"
        className="constraint-expr-input"
      />
    </label>
  );
}

// ── FOREIGN KEY 編集 ──────────────────────────────────────────────────────────

function FkEditor({
  c, table, allTables, onUpdate,
}: {
  c: ForeignKeyConstraint;
  table: Table;
  allTables: Table[];
  onUpdate: (patch: Partial<Constraint>) => void;
}) {
  const refTable = allTables.find((t) => t.id === c.referencedTableId);

  const toggleSrcCol = (colId: LocalId) => {
    const cols = c.columnIds.includes(colId)
      ? c.columnIds.filter((x) => x !== colId)
      : [...c.columnIds, colId];
    onUpdate({ columnIds: cols } as Partial<ForeignKeyConstraint>);
  };

  const toggleRefCol = (colId: LocalId) => {
    const cols = c.referencedColumnIds.includes(colId)
      ? c.referencedColumnIds.filter((x) => x !== colId)
      : [...c.referencedColumnIds, colId];
    onUpdate({ referencedColumnIds: cols } as Partial<ForeignKeyConstraint>);
  };

  return (
    <>
      <div className="constraint-editor-field">
        <span>自テーブルの列</span>
        <div className="constraint-col-chips">
          {table.columns.map((col) => (
            <label
              key={col.id}
              className={`constraint-col-chip${c.columnIds.includes(col.id) ? " selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={c.columnIds.includes(col.id)}
                onChange={() => toggleSrcCol(col.id)}
              />
              {col.physicalName}
            </label>
          ))}
        </div>
      </div>

      <label className="constraint-editor-field">
        <span>参照先テーブル</span>
        <select
          value={c.referencedTableId ?? ""}
          onChange={(e) =>
            onUpdate({
              referencedTableId: (e.target.value || "") as TableId,
              referencedColumnIds: [],
            } as Partial<ForeignKeyConstraint>)
          }
        >
          <option value="">テーブルを選択...</option>
          {allTables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.physicalName}（{t.name}）
            </option>
          ))}
        </select>
      </label>

      {refTable && (
        <div className="constraint-editor-field">
          <span>参照先列</span>
          <div className="constraint-col-chips">
            {refTable.columns.map((col) => (
              <label
                key={col.id}
                className={`constraint-col-chip${c.referencedColumnIds.includes(col.id) ? " selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={c.referencedColumnIds.includes(col.id)}
                  onChange={() => toggleRefCol(col.id)}
                />
                {col.physicalName}
                {col.primaryKey && <i className="bi bi-key-fill" style={{ marginLeft: 3, fontSize: 10 }} />}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="constraint-fk-actions-row">
        <label className="constraint-editor-field">
          <span>ON DELETE</span>
          <select
            value={c.onDelete ?? ""}
            onChange={(e) =>
              onUpdate({ onDelete: (e.target.value as FkAction) || undefined } as Partial<ForeignKeyConstraint>)
            }
          >
            <option value="">(指定なし)</option>
            {FK_ACTIONS.map((a) => <option key={a} value={a}>{FK_ACTION_LABELS[a]}</option>)}
          </select>
        </label>
        <label className="constraint-editor-field">
          <span>ON UPDATE</span>
          <select
            value={c.onUpdate ?? ""}
            onChange={(e) =>
              onUpdate({ onUpdate: (e.target.value as FkAction) || undefined } as Partial<ForeignKeyConstraint>)
            }
          >
            <option value="">(指定なし)</option>
            {FK_ACTIONS.map((a) => <option key={a} value={a}>{FK_ACTION_LABELS[a]}</option>)}
          </select>
        </label>
        <label className="constraint-editor-field constraint-fk-noconstraint">
          <span>論理 FK (DDL に出力しない)</span>
          <input
            type="checkbox"
            checked={c.noConstraint ?? false}
            onChange={(e) =>
              onUpdate({ noConstraint: e.target.checked || undefined } as Partial<ForeignKeyConstraint>)
            }
          />
        </label>
      </div>
    </>
  );
}

// ── ヘルパー ──────────────────────────────────────────────────────────────────

function buildDefault(kind: ConstraintKind): Omit<Constraint, "id"> {
  switch (kind) {
    case "unique":
      return { kind, columnIds: [], description: "" } as Omit<UniqueConstraint, "id">;
    case "check":
      return { kind, expression: "", description: "" } as Omit<CheckConstraint, "id">;
    case "foreignKey":
      return {
        kind,
        columnIds: [],
        referencedTableId: "" as TableId,
        referencedColumnIds: [],
        description: "",
      } as Omit<ForeignKeyConstraint, "id">;
  }
  const _never: never = kind;
  return _never;
}

function kindBadge(kind: Constraint["kind"]): string {
  switch (kind) {
    case "unique": return "UNIQUE";
    case "check": return "CHECK";
    case "foreignKey": return "FK";
  }
}

function colPhysical(table: Table, columnId: string): string {
  return table.columns.find((c) => c.id === columnId)?.physicalName ?? columnId;
}

function constraintSummary(c: Constraint, table: Table, allTables: Table[]): string {
  switch (c.kind) {
    case "unique":
      return c.columnIds.length > 0
        ? `列: ${c.columnIds.map((id) => colPhysical(table, id)).join(", ")}`
        : "(列未選択)";
    case "check":
      return c.expression ? `式: ${c.expression}` : "(式未設定)";
    case "foreignKey": {
      const srcCols = c.columnIds.length > 0
        ? c.columnIds.map((id) => colPhysical(table, id)).join(", ")
        : "(列未選択)";
      const refTable = allTables.find((t) => t.id === c.referencedTableId);
      const refTableName = refTable?.physicalName ?? "(参照先未設定)";
      const refCols = refTable && c.referencedColumnIds.length > 0
        ? c.referencedColumnIds.map((id) => colPhysical(refTable, id)).join(", ")
        : "?";
      const ref = refTable ? `${refTableName}(${refCols})` : refTableName;
      const onDelete = c.onDelete ? ` ON DELETE ${FK_ACTION_LABELS[c.onDelete]}` : "";
      return `${srcCols} → ${ref}${onDelete}`;
    }
  }
}
