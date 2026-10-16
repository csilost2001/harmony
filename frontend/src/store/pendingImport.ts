/**
 * 画面にファイルをドロップして取り込みを始める (UI 改善提案 第 3 弾 #46) ときの、読み込んだ文の受け渡し。
 * ドロップを受けた側が置き、「連携と運用 → 取り込み」の入力欄が、開いたときに 1 回だけ受け取る。
 */
export type ImportKind = "ddl" | "openapi";

const pending = new Map<ImportKind, string>();

export function setPendingImport(kind: ImportKind, text: string): void { pending.set(kind, text); }

/** 置いてある文を、1 回だけ取り出す (無ければ null) */
export function takePendingImport(kind: ImportKind): string | null {
  const v = pending.get(kind) ?? null;
  pending.delete(kind);
  return v;
}

/** ファイル名から、取り込みの種類を決める。.sql / .ddl = DDL、.json = OpenAPI。それ以外は null */
export function importKindOf(fileName: string): ImportKind | "xlsx" | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "sql" || ext === "ddl") return "ddl";
  if (ext === "json") return "openapi";
  if (ext === "xlsx") return "xlsx";
  return null;
}
