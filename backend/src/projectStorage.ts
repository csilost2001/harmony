/**
 * projectStorage.ts
 * ファイルベースのプロジェクトデータ永続化ユーティリティ。
 *
 * #671 以降、active workspace path は `workspaceState` モジュールが保持する。
 * #700 R-2: LEGACY_CLIENT_ID / 後方互換 wrapper を完全削除。
 * 全 public 関数は `root: string` を必須引数として受け取る。
 * 呼び出し側は `resolveRoot(clientId)` で per-session root を解決してから渡す。
 * active 未選択時は WorkspaceUnsetError を throw する。
 */
import fs from "fs/promises";
import path from "path";
import Ajv, { type ValidateFunction } from "ajv";
import { workspaceContextManager } from "./workspaceState.js";

// ── path 解決ヘルパー (#671 + #700 R-2) ─────────────────────────────────────
// workspace 切替に追従するため、絶対パス constant を廃止し getter 関数化。
//
// レース対策 (#676 review 7 周目): 各 getter は optional root を受け、未指定なら
// requireActivePath(clientId) からフォールバック取得する。複数 path を生成する公開関数は
// 関数開始時に root を 1 度だけスナップショットし、すべての helper にそれを渡す
// ことで、操作中に workspace 切替が起きても書き込み先が分散しないようにする。
//
// #700 R-2: LEGACY 削除。clientId 必須。root は内部 helper 専用 (snapshot 規約)。

/**
 * clientId から per-session active root を解決するヘルパー (#700 R-2)。
 * clientId が渡された場合は WorkspaceContextManager 経由で解決。
 * root が渡された場合は snapshot path を直接使用 (内部 helper 向け)。
 */
export function resolveRoot(clientId: string): string {
  return workspaceContextManager.requireActivePath(clientId);
}

/**
 * root path を返す内部ヘルパー (snapshot 規約用)。
 * root が渡されればそれを、なければ clientId で解決する。
 * NOTE: public 関数の引数としては使わない — root は関数内でスナップショットした値を
 * 内部 helper に渡すためのもの。
 */
export function dataDir(root: string): string {
  return root;
}

const screensDir       = (root: string) => path.join(root, "screens");
const tablesDir        = (root: string) => path.join(root, "tables");
const actionsDir       = (root: string) => path.join(root, "actions");
const processFlowsDir  = (root: string) => path.join(root, "process-flows");
const conventionsDir   = (root: string) => path.join(root, "conventions");
const screenItemsDir   = (root: string) => path.join(root, "screen-items");
const sequencesDir     = (root: string) => path.join(root, "sequences");
const viewsDir         = (root: string) => path.join(root, "views");
const viewDefsDir      = (root: string) => path.join(root, "view-definitions");
export const extensionsDir    = (root: string) => path.join(root, "extensions");
export const projectFile      = (root: string) => path.join(root, "project.json");
export const customBlocksFile = (root: string) => path.join(root, "custom-blocks.json");
export const puckComponentsFile = (root: string) => path.join(root, "puck-components.json");
export const erLayoutFile     = (root: string) => path.join(root, "er-layout.json");
export const screenLayoutFile = (root: string) => path.join(root, "screen-layout.json");
export const conventionsFile  = (root: string) => path.join(conventionsDir(root), "catalog.json");

const EXTENSION_FILE_NAMES = {
  steps: "steps.json",
  fieldTypes: "field-types.json",
  triggers: "triggers.json",
  dbOperations: "db-operations.json",
  responseTypes: "response-types.json",
} as const;

export type ExtensionFileKind = keyof typeof EXTENSION_FILE_NAMES;

/** スキーマルートディレクトリ: backend/src/ から 2 段上がって schemas/ */
const SCHEMAS_DIR = path.resolve(import.meta.dirname, "../../schemas");

/** screens/<id>.json から schemas/v3/screen.v3.schema.json への相対 path を計算する */
function screenSchemaRef(root: string): string {
  // workspace は repo 内 (examples/<id>/ or workspaces/<id>/) 配置前提; repo 外 (別ドライブ等) では path.relative が absolute path を返しうる
  const entityDir = screensDir(root);
  const schemaPath = path.join(SCHEMAS_DIR, "v3", "screen.v3.schema.json");
  return path.relative(entityDir, schemaPath).replace(/\\/g, "/");
}

/** ExtensionFileKind → extensions-*.schema.json ファイル名スラグの変換 */
function kindToSchemaSlug(kind: ExtensionFileKind): string {
  switch (kind) {
    case "steps": return "steps";
    case "fieldTypes": return "field-types";
    case "triggers": return "triggers";
    case "dbOperations": return "db-operations";
    case "responseTypes": return "response-types";
  }
}

/** Ajv インスタンスとバリデーター関数のモジュールレベルキャッシュ (#455) */
const _ajv = new Ajv({ allErrors: true });
const _validatorCache = new Map<ExtensionFileKind, ValidateFunction>();

async function getExtensionValidator(kind: ExtensionFileKind): Promise<ValidateFunction> {
  if (!_validatorCache.has(kind)) {
    const schemaPath = path.join(SCHEMAS_DIR, `extensions-${kindToSchemaSlug(kind)}.schema.json`);
    const schemaText = await fs.readFile(schemaPath, "utf-8");
    const schema = JSON.parse(schemaText) as object;
    _validatorCache.set(kind, _ajv.compile(schema));
  }
  return _validatorCache.get(kind)!;
}

/** extensions/*.json の JSON Schema 検証 (#455) */
async function validateExtensionFile(kind: ExtensionFileKind, data: unknown): Promise<void> {
  const validate = await getExtensionValidator(kind);
  if (!validate(data)) {
    throw new Error(
      `extensions/${kind}.json schema 違反: ${_ajv.errorsText(validate.errors)}`
    );
  }
}

/** active workspace 配下のディレクトリ群を作成（既存なら無視） */
export async function ensureDataDir(root: string): Promise<void> {
  const r = root;
  await fs.mkdir(r, { recursive: true });
  await fs.mkdir(screensDir(r), { recursive: true });
  await fs.mkdir(tablesDir(r), { recursive: true });
  await fs.mkdir(actionsDir(r), { recursive: true });
  await fs.mkdir(conventionsDir(r), { recursive: true });
  // screen-items/ は Phase 4-β migration 後に廃止済み — 再作成しない
  await fs.mkdir(sequencesDir(r), { recursive: true });
  await fs.mkdir(viewsDir(r), { recursive: true });
  await fs.mkdir(viewDefsDir(r), { recursive: true });
  await fs.mkdir(extensionsDir(r), { recursive: true });
}

async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJSON(filePath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, json, "utf-8");
}

/** project.json を読み込み（存在しない場合は null） */
export async function readProject(root: string): Promise<unknown | null> {
  return readJSON<unknown>(projectFile(root));
}

/** project.json を書き込み */
export async function writeProject(project: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  const projFile = projectFile(r);
  const next = project as Record<string, unknown>;
  if (next.schemaVersion === "v3") {
    const current = await readJSON<Record<string, unknown>>(projFile);
    if (current && current.schemaVersion !== "v3") {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.copyFile(projFile, `${projFile}.bak.${ts}`);
    }
  }
  await writeJSON(projFile, project);
}

/** 各種データファイルの更新時刻を取得（存在しないなら null） */
export async function getFileMtime(kind: string, root: string, id?: string): Promise<number | null> {
  const r = root;
  const filePath = resolveDataFile(kind, r, id);
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

function resolveDataFile(kind: string, root: string, id?: string): string | null {
  switch (kind) {
    case "project": return projectFile(root);
    case "erLayout": return erLayoutFile(root);
    case "customBlocks": return customBlocksFile(root);
    case "conventions": return conventionsFile(root);
    case "screen": return id ? path.join(screensDir(root), `${id}.design.json`) : null;
    case "screenEntity": return id ? path.join(screensDir(root), `${id}.json`) : null;
    case "table": return id ? path.join(tablesDir(root), `${id}.json`) : null;
    case "processFlow": return id ? path.join(actionsDir(root), `${id}.json`) : null;
    case "screenItems": return id ? path.join(screenItemsDir(root), `${id}.json`) : null;
    case "sequence": return id ? path.join(sequencesDir(root), `${id}.json`) : null;
    case "view": return id ? path.join(viewsDir(root), `${id}.json`) : null;
    case "viewDefinition": return id ? path.join(viewDefsDir(root), `${id}.json`) : null;
    default: return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLegacyGrapesScreen(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Array.isArray(value.pages) || "frames" in value || "component" in value || "styles" in value;
}

function isScreenEntity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const schemaStr = typeof value.$schema === "string" ? value.$schema : "";
  return schemaStr.endsWith("schemas/v3/screen.v3.schema.json") || (
    typeof value.kind === "string" &&
    typeof value.path === "string" &&
    ("items" in value || "design" in value || "id" in value)
  );
}

function getScreenEntry(project: unknown, screenId: string): Record<string, unknown> | null {
  if (!isRecord(project)) return null;
  const entities = isRecord(project.entities) ? project.entities : null;
  const v3Screens = Array.isArray(entities?.screens) ? entities.screens : null;
  const legacyScreens = Array.isArray(project.screens) ? project.screens : null;
  const screens = v3Screens ?? legacyScreens ?? [];
  const found = screens.find((s) => isRecord(s) && s.id === screenId);
  return isRecord(found) ? found : null;
}

function extractItems(value: unknown): unknown[] {
  return isRecord(value) && Array.isArray(value.items) ? value.items : [];
}

function buildDefaultScreenEntity(
  screenId: string,
  entry: Record<string, unknown> | null,
  items: unknown[],
  root: string,
): Record<string, unknown> {
  const ts = new Date().toISOString();
  const updatedAt = typeof entry?.updatedAt === "string" ? entry.updatedAt : ts;
  return {
    $schema: screenSchemaRef(root),
    id: screenId,
    name: typeof entry?.name === "string" && entry.name ? entry.name : screenId,
    ...(typeof entry?.description === "string" && entry.description ? { description: entry.description } : {}),
    ...(typeof entry?.maturity === "string" ? { maturity: entry.maturity } : {}),
    createdAt: typeof entry?.createdAt === "string" ? entry.createdAt : updatedAt,
    updatedAt,
    kind: typeof entry?.kind === "string" && entry.kind ? entry.kind : "other",
    path: typeof entry?.path === "string" ? entry.path : "",
    ...(typeof entry?.groupId === "string" ? { groupId: entry.groupId } : {}),
    items,
    design: { designFileRef: `${screenId}.design.json` },
  };
}

/** per-(root, screenId) の in-flight migration を 1 つに集約する Promise キャッシュ。
 * key を root::screenId にすることで、workspace 切替後も別 root の migration と独立に動く。 */
const _inflightMigrations = new Map<string, Promise<Record<string, unknown> | null>>();

async function _migrateScreenCore(screenId: string, root: string): Promise<Record<string, unknown> | null> {
  await ensureDataDir(root);
  const entityPath = path.join(screensDir(root), `${screenId}.json`);
  const designPath = path.join(screensDir(root), `${screenId}.design.json`);
  const legacyItemsPath = path.join(screenItemsDir(root), `${screenId}.json`);
  const current = await readJSON<unknown>(entityPath);

  if (isScreenEntity(current) && !isLegacyGrapesScreen(current)) {
    return current as Record<string, unknown>;
  }

  if (isLegacyGrapesScreen(current)) {
    try {
      await fs.rename(entityPath, designPath);
    } catch {
      await writeJSON(designPath, current);
    }
    const project = await readProject(root);
    const itemsFile = await readJSON<unknown>(legacyItemsPath);
    const entity = buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), extractItems(itemsFile), root);
    await writeJSON(entityPath, entity);
    try { await fs.unlink(legacyItemsPath); } catch { /* ignore */ }
    return entity;
  }

  const design = await readJSON<unknown>(designPath);
  const itemsFile = await readJSON<unknown>(legacyItemsPath);
  if (design || itemsFile) {
    const project = await readProject(root);
    const entity = buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), extractItems(itemsFile), root);
    await writeJSON(entityPath, entity);
    try { await fs.unlink(legacyItemsPath); } catch { /* ignore */ }
    return entity;
  }

  return null;
}

async function migrateScreenIfNeeded(screenId: string, root: string): Promise<Record<string, unknown> | null> {
  const r = dataDir(root);
  const key = `${r}::${screenId}`;
  const existing = _inflightMigrations.get(key);
  if (existing) return existing;

  const promise = _migrateScreenCore(screenId, r).finally(() => {
    _inflightMigrations.delete(key);
  });
  _inflightMigrations.set(key, promise);
  return promise;
}

/** data/extensions/*.json を生 JSON バンドルとして読み込み (#444) */
export async function readExtensionsBundle(root: string): Promise<Record<ExtensionFileKind, unknown | null>> {
  const r = root;
  await ensureDataDir(r);
  const extDir = extensionsDir(r);
  const entries = await Promise.all(
    Object.entries(EXTENSION_FILE_NAMES).map(async ([kind, fileName]) => {
      const data = await readJSON<unknown>(path.join(extDir, fileName));
      return [kind, data] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ExtensionFileKind, unknown | null>;
}

/** data/extensions/{type}.json を単体書き込み (validation 付き、broadcast コールバック対応) (#455) */
export async function writeExtensionsFile(
  type: ExtensionFileKind,
  content: unknown,
  root: string,
  options?: { onAfterWrite?: () => void; skipValidation?: boolean },
): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  if (!options?.skipValidation) {
    await validateExtensionFile(type, content);
  }
  await writeJSON(path.join(extensionsDir(r), EXTENSION_FILE_NAMES[type]), content);
  options?.onAfterWrite?.();
}

/** screens/{screenId}.json を読み込み */
export async function readScreen(screenId: string, root: string): Promise<unknown | null> {
  const r = root;
  await migrateScreenIfNeeded(screenId, r);
  return readJSON<unknown>(path.join(screensDir(r), `${screenId}.design.json`));
}

/** screens/{screenId}.json を書き込み */
export async function writeScreen(screenId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  let entity = await migrateScreenIfNeeded(screenId, r);
  if (!entity) {
    const project = await readProject(r);
    entity = buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), [], r);
  }
  entity = {
    ...entity,
    $schema: screenSchemaRef(r),
    updatedAt: new Date().toISOString(),
    design: {
      ...(isRecord(entity.design) ? entity.design : {}),
      designFileRef: `${screenId}.design.json`,
    },
  };
  const sDir = screensDir(r);
  await writeJSON(path.join(sDir, `${screenId}.json`), entity);
  await writeJSON(path.join(sDir, `${screenId}.design.json`), data);
}

export async function readScreenEntity(screenId: string, root: string): Promise<unknown | null> {
  return migrateScreenIfNeeded(screenId, root);
}

export async function writeScreenEntity(screenId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  const current = isRecord(data) ? data : {};
  const project = await readProject(r);
  const entry = getScreenEntry(project, screenId);
  const toSave = {
    ...buildDefaultScreenEntity(screenId, entry, [], r),
    ...current,
    $schema: screenSchemaRef(r),
    id: typeof current.id === "string" ? current.id : screenId,
    kind: typeof current.kind === "string" ? current.kind : (typeof entry?.kind === "string" ? entry.kind : "other"),
    path: typeof current.path === "string" ? current.path : (typeof entry?.path === "string" ? entry.path : ""),
    updatedAt: new Date().toISOString(),
    design: {
      ...(isRecord(current.design) ? current.design : {}),
      designFileRef: `${screenId}.design.json`,
    },
  };
  await writeJSON(path.join(screensDir(r), `${screenId}.json`), toSave);
}

/** screens/{screenId}.json を削除（存在しない場合は無視） */
export async function deleteScreen(screenId: string, root: string): Promise<void> {
  const r = root;
  const sDir = screensDir(r);
  const siDir = screenItemsDir(r);
  try {
    await fs.unlink(path.join(sDir, `${screenId}.json`));
  } catch { /* file not found is OK */ }
  try {
    await fs.unlink(path.join(sDir, `${screenId}.design.json`));
  } catch { /* file not found is OK */ }
  try {
    await fs.unlink(path.join(siDir, `${screenId}.json`));
  } catch { /* file not found is OK */ }
}

/** custom-blocks.json を読み込み */
export async function readCustomBlocks(root: string): Promise<unknown[]> {
  const r = root;
  return (await readJSON<unknown[]>(customBlocksFile(r))) ?? [];
}

/** custom-blocks.json を書き込み */
export async function writeCustomBlocks(blocks: unknown[], root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(customBlocksFile(r), blocks);
}

/** screens/{screenId}/puck-data.json を読み込み (#806) */
export async function readPuckData(screenId: string, root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(path.join(screensDir(r), screenId, "puck-data.json"));
}

/** screens/{screenId}/puck-data.json を書き込み (#806) */
export async function writePuckData(screenId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  const puckDir = path.join(screensDir(r), screenId);
  await fs.mkdir(puckDir, { recursive: true });
  await writeJSON(path.join(puckDir, "puck-data.json"), data);
}

/** puck-components.json を読み込み */
export async function readPuckComponents(root: string): Promise<unknown[]> {
  const r = root;
  return (await readJSON<unknown[]>(puckComponentsFile(r))) ?? [];
}

/** puck-components.json を書き込み */
export async function writePuckComponents(components: unknown[], root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(puckComponentsFile(r), components);
}

/** er-layout.json を読み込み */
export async function readErLayout(root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(erLayoutFile(r));
}

/** er-layout.json を書き込み */
export async function writeErLayout(data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(erLayoutFile(r), data);
}

/** screen-layout.json を読み込み (Phase 3-β、#561) */
export async function readScreenLayout(root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(screenLayoutFile(r));
}

/** screen-layout.json を書き込み (Phase 3-β、#561) */
export async function writeScreenLayout(data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(screenLayoutFile(r), data);
}

/** tables/{tableId}.json を読み込み */
export async function readTable(tableId: string, root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(path.join(tablesDir(r), `${tableId}.json`));
}

/** tables/{tableId}.json を書き込み */
export async function writeTable(tableId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(path.join(tablesDir(r), `${tableId}.json`), data);
}

/** tables/{tableId}.json を削除（存在しない場合は無視） */
export async function deleteTable(tableId: string, root: string): Promise<void> {
  const r = root;
  try {
    await fs.unlink(path.join(tablesDir(r), `${tableId}.json`));
  } catch { /* file not found is OK */ }
}

/** tables/ ディレクトリ内の全テーブル定義を読み込み (#587) */
export async function listAllTables(root: string): Promise<unknown[]> {
  try {
    const r = root;
    await ensureDataDir(r);
    const tDir = tablesDir(r);
    const files = await fs.readdir(tDir);
    const results: unknown[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await readJSON<unknown>(path.join(tDir, file));
      if (data) results.push(data);
    }
    return results;
  } catch {
    return [];
  }
}

function processFlowFileCandidates(root: string, processFlowId: string): string[] {
  return [
    path.join(actionsDir(root), `${processFlowId}.json`),
    path.join(processFlowsDir(root), `${processFlowId}.json`),
  ];
}

/** actions/{processFlowId}.json または process-flows/{processFlowId}.json を読み込み */
export async function readProcessFlow(processFlowId: string, root: string): Promise<unknown | null> {
  const r = root;
  for (const filePath of processFlowFileCandidates(r, processFlowId)) {
    const data = await readJSON<unknown>(filePath);
    if (data) return data;
  }
  return null;
}

/** 既存配置を優先して処理フローを書き込み */
export async function writeProcessFlow(processFlowId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  const [legacyPath, currentPath] = processFlowFileCandidates(r, processFlowId);
  const targetPath = await fileExists(currentPath) ? currentPath : legacyPath;
  await writeJSON(targetPath, data);
}

/** actions/process-flows 両配置の処理フローを削除（存在しない場合は無視） */
export async function deleteProcessFlow(processFlowId: string, root: string): Promise<void> {
  const r = root;
  for (const filePath of processFlowFileCandidates(r, processFlowId)) {
    try {
      await fs.unlink(filePath);
    } catch { /* file not found is OK */ }
  }
}

/** conventions/catalog.json を読み込み (#317) */
export async function readConventions(root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(conventionsFile(r));
}

/** conventions/catalog.json を書き込み (#317) */
export async function writeConventions(data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(conventionsFile(r), data);
}

/** screen-items/{screenId}.json を読み込み (#318) */
export async function readScreenItems(screenId: string, root: string): Promise<unknown | null> {
  const screen = await readScreenEntity(screenId, root);
  if (!isRecord(screen)) return null;
  return {
    screenId,
    updatedAt: typeof screen.updatedAt === "string" ? screen.updatedAt : new Date().toISOString(),
    items: Array.isArray(screen.items) ? screen.items : [],
  };
}

/** screen-items/{screenId}.json を書き込み (#318) */
export async function writeScreenItems(screenId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const current = (await migrateScreenIfNeeded(screenId, r)) as Record<string, unknown> | null;
  const project = await readProject(r);
  const items = extractItems(data);
  const next = {
    ...(current ?? buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), [], r)),
    items,
    updatedAt: new Date().toISOString(),
  };
  await writeScreenEntity(screenId, next, r);
  try { await fs.unlink(path.join(screenItemsDir(r), `${screenId}.json`)); } catch { /* ignore */ }
}

/** screen-items/{screenId}.json を削除 (#318) */
export async function deleteScreenItems(screenId: string, root: string): Promise<void> {
  const r = root;
  const current = (await migrateScreenIfNeeded(screenId, r)) as Record<string, unknown> | null;
  if (current) {
    await writeScreenEntity(screenId, { ...current, items: [] }, r);
  }
  try {
    await fs.unlink(path.join(screenItemsDir(r), `${screenId}.json`));
  } catch { /* file not found is OK */ }
}

/** sequences/{sequenceId}.json を読み込み (#374) */
export async function readSequence(sequenceId: string, root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(path.join(sequencesDir(r), `${sequenceId}.json`));
}

/** sequences/{sequenceId}.json を書き込み (#374) */
export async function writeSequence(sequenceId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(path.join(sequencesDir(r), `${sequenceId}.json`), data);
}

/** sequences/{sequenceId}.json を削除（存在しない場合は無視） (#374) */
export async function deleteSequence(sequenceId: string, root: string): Promise<void> {
  const r = root;
  try {
    await fs.unlink(path.join(sequencesDir(r), `${sequenceId}.json`));
  } catch { /* file not found is OK */ }
}

/** views/ ディレクトリ内の全ビュー定義を読み込み (#587) */
export async function listAllViews(root: string): Promise<unknown[]> {
  try {
    const r = root;
    await ensureDataDir(r);
    const vDir = viewsDir(r);
    const files = await fs.readdir(vDir);
    const results: unknown[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await readJSON<unknown>(path.join(vDir, file));
      if (data) results.push(data);
    }
    return results;
  } catch {
    return [];
  }
}

/** views/{viewId}.json を読み込み (v3 per-entity #549) */
export async function readView(viewId: string, root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(path.join(viewsDir(r), `${viewId}.json`));
}

/** views/{viewId}.json を書き込み (v3 per-entity #549) */
export async function writeView(viewId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(path.join(viewsDir(r), `${viewId}.json`), data);
}

/** views/{viewId}.json を削除（存在しない場合は無視） (v3 per-entity #549) */
export async function deleteView(viewId: string, root: string): Promise<void> {
  const r = root;
  try {
    await fs.unlink(path.join(viewsDir(r), `${viewId}.json`));
  } catch { /* file not found is OK */ }
}

export async function listAllViewDefinitions(root: string): Promise<unknown[]> {
  try {
    const r = root;
    await ensureDataDir(r);
    const vdDir = viewDefsDir(r);
    const files = await fs.readdir(vdDir);
    const results: unknown[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await readJSON<unknown>(path.join(vdDir, file));
      if (data) results.push(data);
    }
    return results;
  } catch {
    return [];
  }
}

export async function readViewDefinition(viewDefinitionId: string, root: string): Promise<unknown | null> {
  const r = root;
  return readJSON<unknown>(path.join(viewDefsDir(r), `${viewDefinitionId}.json`));
}

export async function writeViewDefinition(viewDefinitionId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  await ensureDataDir(r);
  await writeJSON(path.join(viewDefsDir(r), `${viewDefinitionId}.json`), data);
}

export async function deleteViewDefinition(viewDefinitionId: string, root: string): Promise<void> {
  const r = root;
  try {
    await fs.unlink(path.join(viewDefsDir(r), `${viewDefinitionId}.json`));
  } catch { /* file not found is OK */ }
}

/** actions/ と process-flows/ ディレクトリ内の全処理フローを読み込み */
export async function listProcessFlows(root: string): Promise<unknown[]> {
  try {
    const r = root;
    await ensureDataDir(r);
    const byId = new Map<string, unknown>();
    for (const dir of [processFlowsDir(r), actionsDir(r)]) {
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const data = await readJSON<unknown>(path.join(dir, file));
        if (!data || typeof data !== "object") continue;
        const id = (data as { id?: unknown; meta?: { id?: unknown } }).id
          ?? (data as { meta?: { id?: unknown } }).meta?.id;
        byId.set(typeof id === "string" ? id : file.replace(/\.json$/, ""), data);
      }
    }
    return Array.from(byId.values());
  } catch {
    return [];
  }
}
