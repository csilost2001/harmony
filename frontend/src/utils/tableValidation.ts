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
  if (columns.length === 0) {
    errors.push({
      stepId,
      severity: "warning",
      code: "table.columns.empty",
      path: "columns",
      message: "カラムが未定義です",
    });
    // columns 空の時点で PK 未指定は自明なので primaryKey.empty は重複発火させない
  } else if (!columns.some((column) => column.primaryKey)) {
    errors.push({
      stepId,
      severity: "warning",
      code: "table.primaryKey.empty",
      path: "columns",
      message: "主キーが未指定です",
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

  return errors;
}
