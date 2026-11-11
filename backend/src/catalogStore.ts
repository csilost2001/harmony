/**
 * カタログの 1 件の検査と、プロジェクト共通のカタログ (catalogs/external.json) の更新 (#1601)。
 * 処理フロー側 (context.catalogs) の書き換えは processFlowEdits.ts。
 */
import fs from "fs/promises";
import path from "path";
import type { ErrorObject, ValidateFunction } from "ajv";
import { buildHarmonyAjv } from "@harmony/shared";
import { selectAjvErrors } from "./ajvMessages.js";
import { readExternalCatalogs } from "./projectStorage.js";
import { SCHEMAS_DIR, ensureDataDirFromRoot, externalCatalogsFile, withFileLock, writeJSON } from "./storageCore.js";

const CATALOGS_REF = "https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/process-flow.v3.schema.json#/$defs/Catalogs";
let catalogsValidator: Promise<ValidateFunction> | null = null;

/** process-flow.v3 の $defs/Catalogs の検査関数 (process-flow が参照する common.v3 も登録する) */
function getCatalogsValidator(): Promise<ValidateFunction> {
  catalogsValidator ??= (async () => {
    const ajv = buildHarmonyAjv();
    for (const name of ["common.v3.schema.json", "process-flow.v3.schema.json"]) {
      ajv.addSchema(JSON.parse(await fs.readFile(path.join(SCHEMAS_DIR, "v3", name), "utf-8")));
    }
    const validate = ajv.getSchema(CATALOGS_REF);
    if (!validate) throw new Error(`v3 schema が登録されていません: ${CATALOGS_REF}`);
    return validate;
  })();
  return catalogsValidator;
}

/** カタログの 1 件を v3 のスキーマ ($defs/Catalogs) で検査する。キーの形と値の形の両方を見る。違反が無ければ空の配列 */
export async function validateCatalogEntry(catalog: string, key: string, value: unknown): Promise<ErrorObject[]> {
  const validate = await getCatalogsValidator();
  if (validate({ [catalog]: { [key]: value } })) return [];
  return selectAjvErrors(validate.errors ?? []);
}

/**
 * catalogs/external.json を読んで、変えて、書く。同じファイルへの並行の更新は 1 本ずつ。
 * mutate は読んだ中身 (無ければ {}) を書き換える。false を返したら書かない
 */
export async function updateExternalCatalogs(
  root: string,
  mutate: (doc: Record<string, unknown>) => boolean,
): Promise<boolean> {
  const file = externalCatalogsFile(await ensureDataDirFromRoot(root));
  return withFileLock(file, async () => {
    const current = await readExternalCatalogs(root);
    const doc = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
    if (!mutate(doc)) return false;
    await writeJSON(file, doc);
    return true;
  });
}
