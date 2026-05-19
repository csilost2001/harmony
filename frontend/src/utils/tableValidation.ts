import type { Table } from "../types/v3/table";
import type { ValidationError } from "./actionValidation";

// Table 型は現状 namespace を持たないが、将来 plugin / namespace 分離で追加される想定 (#442)。
// それまで physicalName 重複検証を namespace スコープで先行実装するため defensive cast。
function tableNamespace(table: Table): string {
  return ((table as Table & { namespace?: string }).namespace ?? "").trim();
}

export function validateTable(table: Table, allTables: Table[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const stepId = table.id;

  const columns = table.columns ?? [];
  // #1185 提案 C: PK 表現は Column.primaryKey: true (single-column PK) と Constraint.kind=primaryKey (composite PK 含む) の 2 方式。
  // 同時使用は禁止 (mutual exclusion) — どちらの方が PK か曖昧になり DDL 生成が壊れるため。
  const constraintsRaw = (table as Table & { constraints?: Array<Record<string, unknown>> }).constraints ?? [];
  const pkConstraints = constraintsRaw.filter((c) => c.kind === "primaryKey");
  const columnsWithPk = columns.filter((c) => c.primaryKey);

  if (columns.length === 0) {
    errors.push({
      stepId,
      severity: "warning",
      code: "table.columns.empty",
      path: "columns",
      message: "カラムが未定義です",
    });
    // columns 空の時点で PK 未指定は自明なので primaryKey.empty は重複発火させない
  } else if (columnsWithPk.length === 0 && pkConstraints.length === 0) {
    errors.push({
      stepId,
      severity: "warning",
      code: "table.primaryKey.empty",
      path: "columns",
      message: "主キーが未指定です",
    });
  }

  // #1185 提案 C: PK の二重定義は禁止 (Column.primaryKey と Constraint.kind=primaryKey の併用)
  if (columnsWithPk.length > 0 && pkConstraints.length > 0) {
    errors.push({
      stepId,
      severity: "error",
      code: "table.primaryKey.duplicated",
      path: "constraints",
      message: `Column.primaryKey と Constraint.kind=primaryKey が併用されています。どちらか一方に統一してください (composite PK の場合は Constraint 側に統一、単一カラム PK は Column.primaryKey で OK)`,
    });
  }

  // #1185 提案 C: PrimaryKeyConstraint は 1 table 内に最大 1 つ (1 table = 1 PK)
  if (pkConstraints.length > 1) {
    errors.push({
      stepId,
      severity: "error",
      code: "table.primaryKey.multipleConstraints",
      path: "constraints",
      message: `PrimaryKeyConstraint が ${pkConstraints.length} 件定義されています。1 table = 1 PK のため 1 件に統合してください`,
    });
  }

  const namespace = tableNamespace(table);
  const physicalName = table.physicalName?.trim();
  if (!physicalName) {
    errors.push({
      stepId,
      severity: "error",
      code: "table.physicalName.empty",
      path: "physicalName",
      message: "物理名が必須です",
    });
  } else {
    const duplicated = allTables.some((other) =>
      other.id !== table.id &&
      tableNamespace(other) === namespace &&
      other.physicalName?.trim() === physicalName,
    );
    if (duplicated) {
      errors.push({
        stepId,
        severity: "error",
        code: "table.physicalName.duplicate",
        path: "physicalName",
        message: `同じ名前空間に物理名 "${physicalName}" のテーブルが既に存在します`,
      });
    }
  }

  if (!table.name?.trim()) {
    errors.push({
      stepId,
      severity: "warning",
      code: "table.displayName.empty",
      path: "name",
      message: "表示名が未定義です",
    });
  }

  // #1185 追加#2: FK の columnIds と referencedColumnIds の件数一致 (AJV 単体では表現困難なため runtime 検証)
  const constraints = (table as Table & { constraints?: Array<Record<string, unknown>> }).constraints ?? [];
  constraints.forEach((con, idx) => {
    if (con.kind !== "foreignKey") return;
    const cols = Array.isArray(con.columnIds) ? con.columnIds : [];
    const refCols = Array.isArray(con.referencedColumnIds) ? con.referencedColumnIds : [];
    if (cols.length !== refCols.length) {
      errors.push({
        stepId,
        severity: "error",
        code: "table.foreignKey.columnCountMismatch",
        path: `constraints[${idx}].referencedColumnIds`,
        message: `外部キー (constraint id: ${String(con.id ?? "?")}) の columnIds (${cols.length} 件) と referencedColumnIds (${refCols.length} 件) の件数が一致しません`,
      });
    }
  });

  return errors;
}
