/**
 * projectStorage.ts
 * ファイルベースのプロジェクトデータ永続化ユーティリティ。
 *
 * #671 以降、active workspace path は `workspaceState` モジュールが保持する。
 * #700 R-2: LEGACY_CLIENT_ID / 後方互換 wrapper を完全削除。
 * 全 public 関数は `root: string` を必須引数として受け取る。
 * 呼び出し側は `resolveRoot(clientId)` で per-session root を解決してから渡す。
 * active 未選択時は WorkspaceUnsetError を throw する。
 *
 * #851 R-2: path resolve を root ベースから root + dataDir ベースに改修。
 * - harmony.json (workspace marker) は workspace folder root 直下 (dataDir 外)
 * - 全リソースデータは <root>/<dataDir>/ 配下に格納
 * - resolveDataRoot(root) が on-demand で harmony.json を読み dataDir を解決する
 * - ensureDataDir(root, dataDirVal) で呼び出し側が dataDir 値を渡す設計
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import type { ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
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
// #851 R-2: dataDir 解決を追加。harmony.json を on-demand 読み取り。

/**
 * clientId から per-session active root を解決するヘルパー (#700 R-2)。
 * clientId が渡された場合は WorkspaceContextManager 経由で解決。
 * root が渡された場合は snapshot path を直接使用 (内部 helper 向け)。
 */
export function resolveRoot(clientId: string): string {
  return workspaceContextManager.requireActivePath(clientId);
}

// ── Workspace marker file (harmony.json) ────────────────────────────────────

/**
 * harmony.json ファイルのパスを返す (#851 R-2 D-7)。
 * workspace folder root 直下に固定 (dataDir 配下ではない — chicken-and-egg 回避)。
 */
export const harmonyFile = (root: string): string => path.join(root, "harmony.json");

/**
 * harmony.json を読み取り、dataDir フィールドを解決して <root>/<dataDir> を返す。
 * harmony.json が存在しない/dataDir が不正な場合は Error を throw する (#851 R-2)。
 *
 * NOTE: on-demand 読み取り (キャッシュなし)。workspace 切替が頻繁でないため軽微。
 * キャッシュは R-3/R-5 で必要に応じて追加する。
 */
export async function resolveDataRoot(root: string): Promise<string> {
  const filePath = harmonyFile(root);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    throw new Error(`harmony.json が見つかりません: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`harmony.json の JSON パースに失敗しました: ${filePath}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).dataDir !== "string" ||
    ((parsed as Record<string, unknown>).dataDir as string).length === 0
  ) {
    throw new Error(`harmony.json の dataDir フィールドが不正または空です: ${filePath}`);
  }
  const dataDirValue = (parsed as Record<string, unknown>).dataDir as string;
  return path.join(root, dataDirValue);
}

// ── Data subdirectory helpers (dataRoot ベース) ──────────────────────────────
// 引数は dataRoot = path.join(root, dataDir) を期待する。

const screensDir       = (dataRoot: string) => path.join(dataRoot, "screens");
const tablesDir        = (dataRoot: string) => path.join(dataRoot, "tables");
const actionsDir       = (dataRoot: string) => path.join(dataRoot, "actions");
const processFlowsDir  = (dataRoot: string) => path.join(dataRoot, "process-flows");
const conventionsDir   = (dataRoot: string) => path.join(dataRoot, "conventions");
const screenItemsDir   = (dataRoot: string) => path.join(dataRoot, "screen-items");
const sequencesDir     = (dataRoot: string) => path.join(dataRoot, "sequences");
const viewsDir         = (dataRoot: string) => path.join(dataRoot, "views");
const viewDefsDir      = (dataRoot: string) => path.join(dataRoot, "view-definitions");
export const extensionsDir      = (dataRoot: string) => path.join(dataRoot, "extensions");
export const customBlocksFile   = (dataRoot: string) => path.join(dataRoot, "custom-blocks.json");
export const puckComponentsFile = (dataRoot: string) => path.join(dataRoot, "puck-components.json");
export const erLayoutFile       = (dataRoot: string) => path.join(dataRoot, "er-layout.json");
export const screenFlowPositionsFile = (dataRoot: string) => path.join(dataRoot, "screen-flow-positions.json");
/** @deprecated Use screenFlowPositionsFile instead. */
export const screenLayoutFile   = screenFlowPositionsFile;
export const conventionsFile    = (dataRoot: string) => path.join(conventionsDir(dataRoot), "catalog.json");

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
function screenSchemaRef(dataRoot: string): string {
  // workspace は repo 内 (examples/<id>/ or workspaces/<id>/) 配置前提; repo 外 (別ドライブ等) では path.relative が absolute path を返しうる
  const entityDir = screensDir(dataRoot);
  const schemaPath = path.join(SCHEMAS_DIR, "v3", "screen.v3.schema.json");
  return path.relative(entityDir, schemaPath).replace(/\\/g, "/");
}

/**
 * ExtensionFileKind → v3 統合 schema (extensions.v3.schema.json) の対応 sub-property 名。
 *
 * 旧 split schema (`extensions-<slug>.schema.json`) は v3 で `extensions.v3.schema.json` 単一に
 * 統合され (#955)、 5 種別のフィールド名は schema 上で改名された:
 *   - steps         → stepKinds       (object: { <StepName>: CustomStepKind })
 *   - fieldTypes    → fieldTypes      (array of CustomFieldType)
 *   - triggers      → actionTriggers  (array of CustomActionTrigger)
 *   - dbOperations  → dbOperations    (array of CustomDbOperation)
 *   - responseTypes → responseTypes   (object: { <TypeName>: CustomResponseType })
 *
 * data/extensions/<file>.json は旧 file 単位 + 旧キー名 (`triggers` 等) を保持する。
 * 個別 file の AJV 検証時は v3 schema の対応 sub-schema を抜き出し、 旧キー名で wrap した
 * fileSchema を動的構築して compile する。
 */
function kindToV3Key(kind: ExtensionFileKind): string {
  switch (kind) {
    case "steps":         return "stepKinds";
    case "fieldTypes":    return "fieldTypes";
    case "triggers":      return "actionTriggers";
    case "dbOperations":  return "dbOperations";
    case "responseTypes": return "responseTypes";
  }
}

/** ExtensionFileKind → 旧 file 形式の root key 名 (data/extensions/<file>.json の中身の key) */
function kindToFileKey(kind: ExtensionFileKind): string {
  switch (kind) {
    case "steps":         return "steps";
    case "fieldTypes":    return "fieldTypes";
    case "triggers":      return "triggers";
    case "dbOperations":  return "dbOperations";
    case "responseTypes": return "responseTypes";
  }
}

/** Ajv インスタンスとバリデーター関数のモジュールレベルキャッシュ (#455 / #955)。
 * v3 統合 schema (#955) は draft 2020-12 のため Ajv2020 を使用。
 * strict: false は schema 内 description 等の警告を抑制 (workspaceInit.ts:51 と同方針) */
const _ajv = new Ajv2020({ allErrors: true, strict: false });
let _v3SchemasRegistered = false;
const _validatorCache = new Map<ExtensionFileKind, ValidateFunction>();

/**
 * v3 統合 schema (extensions.v3 / common.v3) を ajv に登録する (#955)。
 * extensions.v3 → common.v3 への外部 $ref を解決可能にするため、 両方を addSchema する。
 *
 * 同 $id の重複登録を回避するため、 ajv.getSchema で既存確認してから追加する。
 * (他 validator や別呼び出し経路で既に登録済みの場合がある)
 */
async function ensureV3SchemasRegistered(): Promise<void> {
  if (_v3SchemasRegistered) return;
  const commonSchemaText = await fs.readFile(
    path.join(SCHEMAS_DIR, "v3", "common.v3.schema.json"),
    "utf-8",
  );
  const extensionsSchemaText = await fs.readFile(
    path.join(SCHEMAS_DIR, "v3", "extensions.v3.schema.json"),
    "utf-8",
  );
  const commonSchema = JSON.parse(commonSchemaText) as { $id?: string };
  const extensionsSchema = JSON.parse(extensionsSchemaText) as { $id?: string };
  if (commonSchema.$id && !_ajv.getSchema(commonSchema.$id)) {
    _ajv.addSchema(commonSchema);
  }
  if (extensionsSchema.$id && !_ajv.getSchema(extensionsSchema.$id)) {
    _ajv.addSchema(extensionsSchema);
  }
  _v3SchemasRegistered = true;
}

/**
 * 個別 file 用 AJV validator を取得する (#955)。
 *
 * extensions.v3.schema.json の `allOf[*].properties[<v3Key>]` を抜き出して、
 * 旧 file root 形式 `{ namespace: string, <fileKey>: <subSchema> }` で wrap した
 * fileSchema を動的構築 → compile する。
 */
async function getExtensionValidator(kind: ExtensionFileKind): Promise<ValidateFunction> {
  if (_validatorCache.has(kind)) return _validatorCache.get(kind)!;
  await ensureV3SchemasRegistered();

  const v3SchemaText = await fs.readFile(
    path.join(SCHEMAS_DIR, "v3", "extensions.v3.schema.json"),
    "utf-8",
  );
  const v3Schema = JSON.parse(v3SchemaText) as {
    allOf?: Array<{ properties?: Record<string, unknown> }>;
    $defs?: Record<string, unknown>;
  };
  const v3Key = kindToV3Key(kind);
  const fileKey = kindToFileKey(kind);
  const propsHolder = v3Schema.allOf?.find((s) => s.properties);
  const subSchema = propsHolder?.properties?.[v3Key];
  if (!subSchema) {
    throw new Error(
      `extensions.v3.schema.json に ${v3Key} (kind=${kind}) が定義されていません`,
    );
  }

  // 個別 file 用 schema: root は { namespace, <fileKey>: <subSchema> }。
  // $defs は v3 schema からコピーして相対 $ref (#/$defs/CustomXxx) を解決可能にする。
  // $id は extensions.v3.schema.json と同 directory に配置される URL を仮設定し、
  // common.v3.schema.json への relative $ref を ajv が同 directory から解決可能にする。
  // (common.v3 自体は ensureV3SchemasRegistered で addSchema 登録済み)
  const fileSchema = {
    $id: `https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/extensions-${kind}-file.v3.schema.json`,
    type: "object" as const,
    additionalProperties: false,
    required: ["namespace", fileKey],
    properties: {
      namespace: { type: "string", pattern: "^([a-z][a-z0-9-]{0,29})?$" },
      [fileKey]: subSchema,
    },
    $defs: v3Schema.$defs ?? {},
  };

  const validator = _ajv.compile(fileSchema);
  _validatorCache.set(kind, validator);
  return validator;
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

/**
 * active workspace 配下のデータディレクトリ群を作成（既存なら無視）。
 *
 * #851 R-2: 引数を (root, dataDirVal) の 2 つに変更。
 * - root: workspace folder root
 * - dataDirVal: harmony.json の dataDir 値 (呼び出し側が責任を持って渡す)
 *
 * これにより harmony.json の読み出しに依存せず循環依存を回避する。
 * 呼び出し側 (R-3 で workspace.open / initializeWorkspace から呼ぶ予定) が
 * 責任を持って dataDir を渡す。
 */
export async function ensureDataDir(root: string, dataDirVal: string): Promise<void> {
  const dataRoot = path.join(root, dataDirVal);
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.mkdir(screensDir(dataRoot), { recursive: true });
  await fs.mkdir(tablesDir(dataRoot), { recursive: true });
  await fs.mkdir(actionsDir(dataRoot), { recursive: true });
  await fs.mkdir(conventionsDir(dataRoot), { recursive: true });
  // screen-items/ は Phase 4-β migration 後に廃止済み — 再作成しない
  await fs.mkdir(sequencesDir(dataRoot), { recursive: true });
  await fs.mkdir(viewsDir(dataRoot), { recursive: true });
  await fs.mkdir(viewDefsDir(dataRoot), { recursive: true });
  await fs.mkdir(extensionsDir(dataRoot), { recursive: true });
}

/**
 * ensureDataDir の旧シグネチャ互換ヘルパー (内部のみ使用)。
 * harmony.json から dataDir を解決してから ensureDataDir を呼ぶ。
 */
async function ensureDataDirFromRoot(root: string): Promise<string> {
  const dataRoot = await resolveDataRoot(root);
  const dataDirVal = path.relative(root, dataRoot);
  await ensureDataDir(root, dataDirVal);
  return dataRoot;
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

/** harmony.json を読み込み（存在しない場合は null） */
export async function readProject(root: string): Promise<unknown | null> {
  return readJSON<unknown>(harmonyFile(root));
}

/** harmony.json を書き込み */
export async function writeProject(project: unknown, root: string): Promise<void> {
  const r = root;
  const projFile = harmonyFile(r);
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
  let filePath: string | null;
  if (kind === "project") {
    filePath = harmonyFile(r);
  } else {
    const dataRoot = await resolveDataRoot(r).catch(() => null);
    if (!dataRoot) return null;
    filePath = resolveDataFile(kind, dataRoot, id);
  }
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

function resolveDataFile(kind: string, dataRoot: string, id?: string): string | null {
  switch (kind) {
    case "erLayout": return erLayoutFile(dataRoot);
    case "customBlocks": return customBlocksFile(dataRoot);
    case "conventions": return conventionsFile(dataRoot);
    case "screen": return id ? path.join(screensDir(dataRoot), `${id}.design.json`) : null;
    case "screenEntity": return id ? path.join(screensDir(dataRoot), `${id}.json`) : null;
    case "table": return id ? path.join(tablesDir(dataRoot), `${id}.json`) : null;
    case "processFlow": return id ? path.join(actionsDir(dataRoot), `${id}.json`) : null;
    case "screenItems": return id ? path.join(screenItemsDir(dataRoot), `${id}.json`) : null;
    case "sequence": return id ? path.join(sequencesDir(dataRoot), `${id}.json`) : null;
    case "view": return id ? path.join(viewsDir(dataRoot), `${id}.json`) : null;
    case "viewDefinition": return id ? path.join(viewDefsDir(dataRoot), `${id}.json`) : null;
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
  dataRoot: string,
): Record<string, unknown> {
  const ts = new Date().toISOString();
  const updatedAt = typeof entry?.updatedAt === "string" ? entry.updatedAt : ts;
  return {
    $schema: screenSchemaRef(dataRoot),
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

/** per-(dataRoot, screenId) の in-flight migration を 1 つに集約する Promise キャッシュ。
 * key を dataRoot::screenId にすることで、workspace 切替後も別 root の migration と独立に動く。 */
const _inflightMigrations = new Map<string, Promise<Record<string, unknown> | null>>();

async function _migrateScreenCore(screenId: string, root: string): Promise<Record<string, unknown> | null> {
  const dataRoot = await ensureDataDirFromRoot(root);
  const entityPath = path.join(screensDir(dataRoot), `${screenId}.json`);
  const designPath = path.join(screensDir(dataRoot), `${screenId}.design.json`);
  const legacyItemsPath = path.join(screenItemsDir(dataRoot), `${screenId}.json`);
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
    const entity = buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), extractItems(itemsFile), dataRoot);
    await writeJSON(entityPath, entity);
    try { await fs.unlink(legacyItemsPath); } catch { /* ignore */ }
    return entity;
  }

  const design = await readJSON<unknown>(designPath);
  const itemsFile = await readJSON<unknown>(legacyItemsPath);
  if (design || itemsFile) {
    const project = await readProject(root);
    const entity = buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), extractItems(itemsFile), dataRoot);
    await writeJSON(entityPath, entity);
    try { await fs.unlink(legacyItemsPath); } catch { /* ignore */ }
    return entity;
  }

  return null;
}

async function migrateScreenIfNeeded(screenId: string, root: string): Promise<Record<string, unknown> | null> {
  const key = `${root}::${screenId}`;
  const existing = _inflightMigrations.get(key);
  if (existing) return existing;

  const promise = _migrateScreenCore(screenId, root).finally(() => {
    _inflightMigrations.delete(key);
  });
  _inflightMigrations.set(key, promise);
  return promise;
}

/** data/extensions/*.json を生 JSON バンドルとして読み込み (#444) */
export async function readExtensionsBundle(root: string): Promise<Record<ExtensionFileKind, unknown | null>> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  const extDir = extensionsDir(dataRoot);
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
  const dataRoot = await ensureDataDirFromRoot(r);
  if (!options?.skipValidation) {
    await validateExtensionFile(type, content);
  }
  await writeJSON(path.join(extensionsDir(dataRoot), EXTENSION_FILE_NAMES[type]), content);
  options?.onAfterWrite?.();
}

/** screens/{screenId}.json を読み込み */
export async function readScreen(screenId: string, root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  await migrateScreenIfNeeded(screenId, r);
  return readJSON<unknown>(path.join(screensDir(dataRoot), `${screenId}.design.json`));
}

/** screens/{screenId}.json を書き込み */
export async function writeScreen(screenId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  let entity = await migrateScreenIfNeeded(screenId, r);
  if (!entity) {
    const project = await readProject(r);
    entity = buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), [], dataRoot);
  }
  entity = {
    ...entity,
    $schema: screenSchemaRef(dataRoot),
    updatedAt: new Date().toISOString(),
    design: {
      ...(isRecord(entity.design) ? entity.design : {}),
      designFileRef: `${screenId}.design.json`,
    },
  };
  const sDir = screensDir(dataRoot);
  await writeJSON(path.join(sDir, `${screenId}.json`), entity);
  await writeJSON(path.join(sDir, `${screenId}.design.json`), data);
}

export async function readScreenEntity(screenId: string, root: string): Promise<unknown | null> {
  return migrateScreenIfNeeded(screenId, root);
}

export async function writeScreenEntity(screenId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  const current = isRecord(data) ? data : {};
  const project = await readProject(r);
  const entry = getScreenEntry(project, screenId);
  const toSave = {
    ...buildDefaultScreenEntity(screenId, entry, [], dataRoot),
    ...current,
    $schema: screenSchemaRef(dataRoot),
    id: typeof current.id === "string" ? current.id : screenId,
    kind: typeof current.kind === "string" ? current.kind : (typeof entry?.kind === "string" ? entry.kind : "other"),
    path: typeof current.path === "string" ? current.path : (typeof entry?.path === "string" ? entry.path : ""),
    updatedAt: new Date().toISOString(),
    design: {
      ...(isRecord(current.design) ? current.design : {}),
      designFileRef: `${screenId}.design.json`,
    },
  };
  await writeJSON(path.join(screensDir(dataRoot), `${screenId}.json`), toSave);
}

/** screens/{screenId}.json を削除（存在しない場合は無視） */
export async function deleteScreen(screenId: string, root: string): Promise<void> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  const sDir = screensDir(dataRoot);
  const siDir = screenItemsDir(dataRoot);
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
  const dataRoot = await resolveDataRoot(r);
  return (await readJSON<unknown[]>(customBlocksFile(dataRoot))) ?? [];
}

/** custom-blocks.json を書き込み */
export async function writeCustomBlocks(blocks: unknown[], root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(customBlocksFile(dataRoot), blocks);
}

/** screens/{screenId}/puck-data.json を読み込み (#806) */
export async function readPuckData(screenId: string, root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  return readJSON<unknown>(path.join(screensDir(dataRoot), screenId, "puck-data.json"));
}

/** screens/{screenId}/puck-data.json を書き込み (#806) */
export async function writePuckData(screenId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  const puckDir = path.join(screensDir(dataRoot), screenId);
  await fs.mkdir(puckDir, { recursive: true });
  await writeJSON(path.join(puckDir, "puck-data.json"), data);
}

/** puck-components.json を読み込み */
export async function readPuckComponents(root: string): Promise<unknown[]> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  return (await readJSON<unknown[]>(puckComponentsFile(dataRoot))) ?? [];
}

/** puck-components.json を書き込み */
export async function writePuckComponents(components: unknown[], root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(puckComponentsFile(dataRoot), components);
}

/** er-layout.json を読み込み */
export async function readErLayout(root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  return readJSON<unknown>(erLayoutFile(dataRoot));
}

/** er-layout.json を書き込み */
export async function writeErLayout(data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(erLayoutFile(dataRoot), data);
}

/**
 * screen-flow-positions.json を読み込み (Phase 3-β、#561)
 * 旧 screen-layout.json からの自動 rename migration も実施する (#1029)
 */
export async function readScreenFlowPositions(root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  // startup migration: screen-layout.json → screen-flow-positions.json (#1029)
  const oldPath = path.join(dataRoot, "screen-layout.json");
  const newPath = screenFlowPositionsFile(dataRoot);
  if (fsSync.existsSync(oldPath) && !fsSync.existsSync(newPath)) {
    fsSync.renameSync(oldPath, newPath);
    console.log(`[migration] screen-layout.json → screen-flow-positions.json (${dataRoot})`);
  }
  return readJSON<unknown>(newPath);
}

/** screen-flow-positions.json を書き込み (Phase 3-β、#561) */
export async function writeScreenFlowPositions(data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(screenFlowPositionsFile(dataRoot), data);
}

/** @deprecated Use readScreenFlowPositions instead. */
export const readScreenLayout = readScreenFlowPositions;
/** @deprecated Use writeScreenFlowPositions instead. */
export const writeScreenLayout = writeScreenFlowPositions;

/** tables/{tableId}.json を読み込み */
export async function readTable(tableId: string, root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  return readJSON<unknown>(path.join(tablesDir(dataRoot), `${tableId}.json`));
}

/** tables/{tableId}.json を書き込み */
export async function writeTable(tableId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(path.join(tablesDir(dataRoot), `${tableId}.json`), data);
}

/** tables/{tableId}.json を削除（存在しない場合は無視） */
export async function deleteTable(tableId: string, root: string): Promise<void> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  try {
    await fs.unlink(path.join(tablesDir(dataRoot), `${tableId}.json`));
  } catch { /* file not found is OK */ }
}

/** tables/ ディレクトリ内の全テーブル定義を読み込み (#587) */
export async function listAllTables(root: string): Promise<unknown[]> {
  try {
    const r = root;
    const dataRoot = await ensureDataDirFromRoot(r);
    const tDir = tablesDir(dataRoot);
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

function processFlowFileCandidates(dataRoot: string, processFlowId: string): string[] {
  return [
    path.join(actionsDir(dataRoot), `${processFlowId}.json`),
    path.join(processFlowsDir(dataRoot), `${processFlowId}.json`),
  ];
}

/** actions/{processFlowId}.json または process-flows/{processFlowId}.json を読み込み */
export async function readProcessFlow(processFlowId: string, root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  for (const filePath of processFlowFileCandidates(dataRoot, processFlowId)) {
    const data = await readJSON<unknown>(filePath);
    if (data) return data;
  }
  return null;
}

/** 既存配置を優先して処理フローを書き込み */
export async function writeProcessFlow(processFlowId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  const [legacyPath, currentPath] = processFlowFileCandidates(dataRoot, processFlowId);
  const targetPath = await fileExists(currentPath) ? currentPath : legacyPath;
  await writeJSON(targetPath, data);
}

/** actions/process-flows 両配置の処理フローを削除（存在しない場合は無視） */
export async function deleteProcessFlow(processFlowId: string, root: string): Promise<void> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  for (const filePath of processFlowFileCandidates(dataRoot, processFlowId)) {
    try {
      await fs.unlink(filePath);
    } catch { /* file not found is OK */ }
  }
}

/** conventions/catalog.json を読み込み (#317) */
export async function readConventions(root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  return readJSON<unknown>(conventionsFile(dataRoot));
}

/** conventions/catalog.json を書き込み (#317) */
export async function writeConventions(data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(conventionsFile(dataRoot), data);
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
  const dataRoot = await resolveDataRoot(r);
  const current = (await migrateScreenIfNeeded(screenId, r)) as Record<string, unknown> | null;
  const project = await readProject(r);
  const items = extractItems(data);
  const next = {
    ...(current ?? buildDefaultScreenEntity(screenId, getScreenEntry(project, screenId), [], dataRoot)),
    items,
    updatedAt: new Date().toISOString(),
  };
  await writeScreenEntity(screenId, next, r);
  try { await fs.unlink(path.join(screenItemsDir(dataRoot), `${screenId}.json`)); } catch { /* ignore */ }
}

/** screen-items/{screenId}.json を削除 (#318) */
export async function deleteScreenItems(screenId: string, root: string): Promise<void> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  const current = (await migrateScreenIfNeeded(screenId, r)) as Record<string, unknown> | null;
  if (current) {
    await writeScreenEntity(screenId, { ...current, items: [] }, r);
  }
  try {
    await fs.unlink(path.join(screenItemsDir(dataRoot), `${screenId}.json`));
  } catch { /* file not found is OK */ }
}

/** sequences/{sequenceId}.json を読み込み (#374) */
export async function readSequence(sequenceId: string, root: string): Promise<unknown | null> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  return readJSON<unknown>(path.join(sequencesDir(dataRoot), `${sequenceId}.json`));
}

/** sequences/{sequenceId}.json を書き込み (#374) */
export async function writeSequence(sequenceId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(path.join(sequencesDir(dataRoot), `${sequenceId}.json`), data);
}

/** sequences/{sequenceId}.json を削除（存在しない場合は無視） (#374) */
export async function deleteSequence(sequenceId: string, root: string): Promise<void> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  try {
    await fs.unlink(path.join(sequencesDir(dataRoot), `${sequenceId}.json`));
  } catch { /* file not found is OK */ }
}

/** views/ ディレクトリ内の全ビュー定義を読み込み (#587) */
export async function listAllViews(root: string): Promise<unknown[]> {
  try {
    const r = root;
    const dataRoot = await ensureDataDirFromRoot(r);
    const vDir = viewsDir(dataRoot);
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
  const dataRoot = await resolveDataRoot(r);
  return readJSON<unknown>(path.join(viewsDir(dataRoot), `${viewId}.json`));
}

/** views/{viewId}.json を書き込み (v3 per-entity #549) */
export async function writeView(viewId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(path.join(viewsDir(dataRoot), `${viewId}.json`), data);
}

/** views/{viewId}.json を削除（存在しない場合は無視） (v3 per-entity #549) */
export async function deleteView(viewId: string, root: string): Promise<void> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  try {
    await fs.unlink(path.join(viewsDir(dataRoot), `${viewId}.json`));
  } catch { /* file not found is OK */ }
}

export async function listAllViewDefinitions(root: string): Promise<unknown[]> {
  try {
    const r = root;
    const dataRoot = await ensureDataDirFromRoot(r);
    const vdDir = viewDefsDir(dataRoot);
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
  const dataRoot = await resolveDataRoot(r);
  return readJSON<unknown>(path.join(viewDefsDir(dataRoot), `${viewDefinitionId}.json`));
}

export async function writeViewDefinition(viewDefinitionId: string, data: unknown, root: string): Promise<void> {
  const r = root;
  const dataRoot = await ensureDataDirFromRoot(r);
  await writeJSON(path.join(viewDefsDir(dataRoot), `${viewDefinitionId}.json`), data);
}

export async function deleteViewDefinition(viewDefinitionId: string, root: string): Promise<void> {
  const r = root;
  const dataRoot = await resolveDataRoot(r);
  try {
    await fs.unlink(path.join(viewDefsDir(dataRoot), `${viewDefinitionId}.json`));
  } catch { /* file not found is OK */ }
}

/** actions/ と process-flows/ ディレクトリ内の全処理フローを読み込み */
export async function listProcessFlows(root: string): Promise<unknown[]> {
  try {
    const r = root;
    const dataRoot = await ensureDataDirFromRoot(r);
    const byId = new Map<string, unknown>();
    for (const dir of [processFlowsDir(dataRoot), actionsDir(dataRoot)]) {
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
