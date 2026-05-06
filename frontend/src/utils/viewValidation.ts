import type { View } from "../types/v3";
import type { ValidationError } from "./actionValidation";

// View 型は現状 namespace を持たないが、将来 plugin / namespace 分離で追加される想定 (#442)。
// それまで physicalName 重複検証を namespace スコープで先行実装するため defensive cast。
function viewNamespace(view: View): string {
  return ((view as View & { namespace?: string }).namespace ?? "").trim();
}

export function validateView(view: View, allViews: View[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const stepId = view.id;

  if (!view.selectStatement?.trim()) {
    errors.push({
      stepId,
      severity: "error",
      code: "view.selectStatement.empty",
      path: "selectStatement",
      message: "SELECT 文が必須です",
    });
  }

  if (!view.outputColumns || view.outputColumns.length === 0) {
    errors.push({
      stepId,
      severity: "warning",
      code: "view.outputColumns.empty",
      path: "outputColumns",
      message: "出力列が未定義です",
    });
  }

  const namespace = viewNamespace(view);
  const physicalName = view.physicalName?.trim();
  if (!physicalName) {
    errors.push({
      stepId,
      severity: "error",
      code: "view.physicalName.empty",
      path: "physicalName",
      message: "物理名が必須です",
    });
  } else {
    const duplicated = allViews.some((other) =>
      other.id !== view.id &&
      viewNamespace(other) === namespace &&
      other.physicalName?.trim() === physicalName,
    );
    if (duplicated) {
      errors.push({
        stepId,
        severity: "error",
        code: "view.physicalName.duplicate",
        path: "physicalName",
        message: "物理名が重複しています",
      });
    }
  }

  if (!view.name?.trim()) {
    errors.push({
      stepId,
      severity: "warning",
      code: "view.displayName.empty",
      path: "name",
      message: "表示名が未定義です",
    });
  }

  return errors;
}
