#!/usr/bin/env tsx
/**
 * scripts/migrate/id-naming-2026-05-24.ts
 *
 * RFC #1284 / メタ #1292 / I-3 #1295 — examples/<project-id>/ 配下の全 top-level entity を
 * 旧 UUID id 体系から新 kebab-case id + 不変 uuid 構造へ migration する 1 回限りの script。
 *
 * 対象 entity:
 *   Screen / Table / ProcessFlow / Sequence / View / ViewDefinition / PageLayout
 *   + ScreenGroup (harmony.json 内 entry のみ)
 *
 * 2 phase 動作:
 *   --prepare: mapping JSON のテンプレートを生成 (uuid + name を列挙、id を空欄)
 *   (default) : mapping JSON を読み、apply (file rename + ref 置換)
 *
 * 使用法:
 *   tsx scripts/migrate/id-naming-2026-05-24.ts --prepare
 *   tsx scripts/migrate/id-naming-2026-05-24.ts [--dry-run] [<projectId>]
 *   tsx scripts/migrate/id-naming-2026-05-24.ts [--dry-run] --project-dir <workspaceDir> [--mapping-key <projectId>]
 *
 * 引数:
 *   --prepare         mapping JSON を生成 (既存 file は上書きしない、--prepare-force で上書き)
 *   --prepare-force   既存 mapping を上書き
 *   --dry-run         apply モードで実書き込みしない (差分のみ表示)
 *   <projectId>       例: retail / diary。省略時は全 project
 *   --project-dir     examples/ 以外の workspace root (harmony.json があるディレクトリ)
 *   --mapping-key     --project-dir 適用時に流用する mapping key (例: retail)
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// ─── 設定 ─────────────────────────────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEBAB_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const ENTITY_KINDS = [
  "screen",
  "table",
  "processFlow",
  "sequence",
  "view",
  "viewDefinition",
  "pageLayout",
  "screenGroup",
] as const;
type EntityKind = (typeof ENTITY_KINDS)[number];

/** entity kind → harmony directory 名 (screenGroup は file 無し) */
const KIND_DIR: Record<Exclude<EntityKind, "screenGroup">, string> = {
  screen: "screens",
  table: "tables",
  processFlow: "process-flows",
  sequence: "sequences",
  view: "views",
  viewDefinition: "view-definitions",
  pageLayout: "page-layouts",
};

/** entity kind → harmony.json entities セクション key */
const KIND_TO_ENTITIES_KEY: Record<EntityKind, string> = {
  screen: "screens",
  table: "tables",
  processFlow: "processFlows",
  sequence: "sequences",
  view: "views",
  viewDefinition: "viewDefinitions",
  pageLayout: "pageLayouts",
  screenGroup: "screenGroups",
};

/** ref field 名 → 参照先 kind (ScreenGroup は groupId のみ) */
const REF_FIELD_TO_KIND: Record<string, EntityKind> = {
  screenId: "screen",
  sourceScreenId: "screen",
  targetScreenId: "screen",
  parentScreenId: "screen",
  tableId: "table",
  sourceTableId: "table",
  targetTableId: "table",
  relatedTableId: "table",
  referencedTableId: "table",
  processFlowId: "processFlow",
  handlerFlowId: "processFlow",
  refId: "processFlow",
  sequenceId: "sequence",
  viewId: "view",
  viewDefinitionId: "viewDefinition",
  pageLayoutId: "pageLayout",
  groupId: "screenGroup",
};

/**
 * 配列 ref field 名 → 配列要素の参照先 kind。
 * kind が単一に絞れない (`dependencies` は Table or View) 場合は null = flat lookup を使う。
 */
const ARRAY_REF_FIELD_TO_KIND: Record<string, EntityKind | null> = {
  tableIds: "table",
  dependencies: null,
};

/** template string 接頭辞 `@<kind>.` のうち、kind を EntityKind に解決する辞書 */
const TEMPLATE_PREFIX_TO_KIND: Record<string, EntityKind> = {
  screen: "screen",
  table: "table",
  processFlow: "processFlow",
  sequence: "sequence",
  view: "view",
  viewDefinition: "viewDefinition",
  pageLayout: "pageLayout",
};

// ─── パス解決 ─────────────────────────────────────────────────────────────────

const scriptFile = process.argv[1] ?? __filename;
const repoRoot = resolve(dirname(scriptFile), "..", "..");
const examplesDir = join(repoRoot, "examples");
const mappingPath = join(repoRoot, "scripts", "migrate", "id-naming-2026-05-24-mapping.json");

// ─── 引数解析 ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const prepareMode = args.includes("--prepare") || args.includes("--prepare-force");
const prepareForce = args.includes("--prepare-force");
const dryRun = args.includes("--dry-run");
const KNOWN_FLAGS = new Set(["--prepare", "--prepare-force", "--dry-run", "--project-dir", "--mapping-key"]);
const VALUE_FLAGS = new Set(["--project-dir", "--mapping-key"]);

function failUsage(message: string): never {
  console.error(`usage error: ${message}`);
  process.exit(1);
}

function readFlagValue(name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    const value = eq.slice(name.length + 1);
    if (!value || value.startsWith("--")) failUsage(`${name} requires a value`);
    return value;
  }
  const idx = args.indexOf(name);
  if (idx >= 0) {
    const value = args[idx + 1];
    if (!value || value.startsWith("--")) failUsage(`${name} requires a value`);
    return value;
  }
  return undefined;
}

for (const arg of args) {
  if (!arg.startsWith("--")) continue;
  const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
  if (!KNOWN_FLAGS.has(flagName)) failUsage(`unknown flag: ${flagName}`);
  if (arg.includes("=") && !VALUE_FLAGS.has(flagName)) {
    failUsage(`${flagName} does not accept a value`);
  }
}

const projectDirArg = readFlagValue("--project-dir");
const mappingKeyArg = readFlagValue("--mapping-key");
if (mappingKeyArg && !projectDirArg) {
  failUsage("--mapping-key can only be used with --project-dir");
}

const positional = args.filter((a, idx) => {
  if (a.startsWith("--")) return false;
  const prev = args[idx - 1];
  return prev !== "--project-dir" && prev !== "--mapping-key";
});
if (positional.length > 1) failUsage(`too many positional arguments: ${positional.join(" ")}`);
if (projectDirArg && positional.length > 0) {
  failUsage("--project-dir cannot be combined with positional <projectId>");
}

const targetProject = positional[0];
const targetProjectRoot = projectDirArg ? resolve(projectDirArg) : undefined;
const targetProjectId = targetProjectRoot ? basename(targetProjectRoot) : targetProject;
const targetMappingKey = mappingKeyArg ?? targetProjectId;

// ─── 型定義 ───────────────────────────────────────────────────────────────────

interface EntityRecord {
  uuid: string;
  name: string;
  /** Opus が手動で埋める kebab-case id */
  id: string;
}

type ProjectMapping = Partial<Record<EntityKind, EntityRecord[]>>;
type Mapping = Record<string, ProjectMapping>;

/** apply 時に使用する uuid → id の lookup (per kind) */
type LookupTable = Partial<Record<EntityKind, Map<string, string>>>;

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function readJson<T = unknown>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function writeJson(p: string, data: unknown): void {
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function listProjectDirs(): string[] {
  const items = readdirSync(examplesDir);
  return items
    .filter((name) => {
      const full = join(examplesDir, name);
      try {
        if (!statSync(full).isDirectory()) return false;
      } catch {
        return false;
      }
      return existsSync(join(full, "harmony.json"));
    })
    .map((name) => name);
}

function projectHarmonyDir(projectId: string): string {
  if (targetProjectRoot && projectId === targetProjectId) {
    return join(targetProjectRoot, "harmony");
  }
  return join(examplesDir, projectId, "harmony");
}

function projectRootDir(projectId: string): string {
  if (targetProjectRoot && projectId === targetProjectId) return targetProjectRoot;
  return join(examplesDir, projectId);
}

/** entity file (xxx.json、ただし xxx.design.json は除く) を列挙 */
function listEntityFiles(harmonyDir: string, kindDir: string): string[] {
  const d = join(harmonyDir, kindDir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".design.json"))
    .map((f) => join(d, f));
}

// ─── Phase 1: prepare ─────────────────────────────────────────────────────────

function preparePhase(): void {
  if (targetProjectRoot) {
    console.error("--project-dir は apply mode 専用です。prepare は examples/<projectId> を対象にしてください。");
    process.exit(1);
  }
  if (existsSync(mappingPath) && !prepareForce) {
    console.error(
      `mapping file already exists: ${mappingPath}\n` +
        `--prepare-force で上書き、または直接編集してください。`,
    );
    process.exit(1);
  }

  const projects = targetProject ? [targetProject] : listProjectDirs();
  const mapping: Mapping = {};

  for (const projectId of projects) {
    const harmonyDir = projectHarmonyDir(projectId);
    if (!existsSync(harmonyDir)) {
      console.warn(`(skip) ${projectId}: harmony/ not found`);
      continue;
    }

    const projMap: ProjectMapping = {};

    for (const kind of ENTITY_KINDS) {
      if (kind === "screenGroup") continue;

      const files = listEntityFiles(harmonyDir, KIND_DIR[kind]);
      const recs: EntityRecord[] = [];
      for (const file of files) {
        const data = readJson<Record<string, unknown>>(file);
        let uuid: string | undefined;
        let name: string | undefined;
        if (kind === "processFlow") {
          const meta = isPlainObject(data["meta"]) ? data["meta"] : undefined;
          uuid = typeof meta?.["id"] === "string" ? (meta["id"] as string) : undefined;
          name = typeof meta?.["name"] === "string" ? (meta["name"] as string) : undefined;
        } else {
          uuid = typeof data["id"] === "string" ? (data["id"] as string) : undefined;
          name = typeof data["name"] === "string" ? (data["name"] as string) : undefined;
        }
        if (uuid && UUID_PATTERN.test(uuid)) {
          recs.push({ uuid, name: name ?? "", id: "" });
        } else if (uuid) {
          console.log(`(already kebab) ${projectId}/${kind}: ${uuid}`);
        }
      }
      if (recs.length > 0) {
        projMap[kind] = recs.sort((a, b) => a.uuid.localeCompare(b.uuid));
      }
    }

    // ScreenGroup: harmony.json から抽出
    const harmonyPath = join(examplesDir, projectId, "harmony.json");
    if (existsSync(harmonyPath)) {
      const harmony = readJson<Record<string, unknown>>(harmonyPath);
      const entities = isPlainObject(harmony["entities"]) ? harmony["entities"] : undefined;
      const groups = Array.isArray(entities?.["screenGroups"])
        ? (entities!["screenGroups"] as Array<Record<string, unknown>>)
        : [];
      const sgRecs: EntityRecord[] = [];
      for (const g of groups) {
        const uuid = typeof g["id"] === "string" ? (g["id"] as string) : undefined;
        const name = typeof g["name"] === "string" ? (g["name"] as string) : undefined;
        if (uuid && UUID_PATTERN.test(uuid)) {
          sgRecs.push({ uuid, name: name ?? "", id: "" });
        }
      }
      if (sgRecs.length > 0) {
        projMap.screenGroup = sgRecs.sort((a, b) => a.uuid.localeCompare(b.uuid));
      }
    }

    if (Object.keys(projMap).length > 0) {
      mapping[projectId] = projMap;
    }
  }

  writeJson(mappingPath, mapping);
  const totalUuids = Object.values(mapping).reduce(
    (sum, p) =>
      sum +
      Object.values(p).reduce((s, recs) => s + (Array.isArray(recs) ? recs.length : 0), 0),
    0,
  );
  console.log(`\n✓ mapping written: ${mappingPath}`);
  console.log(`  projects: ${Object.keys(mapping).length}, total UUIDs: ${totalUuids}`);
  console.log(`  各 record の "id" field を kebab-case で埋めて、再実行してください。`);
}

// ─── Phase 2: apply ───────────────────────────────────────────────────────────

function validateMapping(mapping: Mapping): void {
  let hasError = false;

  for (const [projectId, projMap] of Object.entries(mapping)) {
    if (targetMappingKey && projectId !== targetMappingKey) continue;

    for (const [kindStr, recs] of Object.entries(projMap)) {
      const kind = kindStr as EntityKind;
      if (!Array.isArray(recs)) continue;
      const seenIds = new Set<string>();
      for (const rec of recs) {
        if (!rec.id || rec.id.trim() === "") {
          console.error(`[${projectId}/${kind}] id 未指定: uuid=${rec.uuid}, name="${rec.name}"`);
          hasError = true;
          continue;
        }
        if (!KEBAB_PATTERN.test(rec.id)) {
          console.error(
            `[${projectId}/${kind}] id "${rec.id}" が kebab-case pattern 違反 (uuid=${rec.uuid})`,
          );
          hasError = true;
          continue;
        }
        if (seenIds.has(rec.id)) {
          console.error(
            `[${projectId}/${kind}] id "${rec.id}" が重複 (entity type 内 unique 違反)`,
          );
          hasError = true;
          continue;
        }
        seenIds.add(rec.id);
      }
    }
  }

  if (hasError) {
    process.exit(1);
  }
}

/** uuid (per kind) → id の per-project lookup を構築 */
function buildProjectLookup(projMap: ProjectMapping): LookupTable {
  const lookup: LookupTable = {};
  for (const [kindStr, recs] of Object.entries(projMap)) {
    const kind = kindStr as EntityKind;
    if (!Array.isArray(recs)) continue;
    const m = new Map<string, string>();
    for (const rec of recs) {
      m.set(rec.uuid, rec.id);
    }
    lookup[kind] = m;
  }
  return lookup;
}

/** 全 kind 横断 lookup: uuid → { kind, id }。screen-flow-positions 等で kind 不明な置換に使う */
function buildFlatLookup(projLookup: LookupTable): Map<string, { kind: EntityKind; id: string }> {
  const flat = new Map<string, { kind: EntityKind; id: string }>();
  for (const [kindStr, m] of Object.entries(projLookup)) {
    const kind = kindStr as EntityKind;
    if (!m) continue;
    for (const [uuid, id] of m.entries()) {
      flat.set(uuid, { kind, id });
    }
  }
  return flat;
}

/** value が UUID で参照先 kind の lookup に登録済なら置換、そうでなければそのまま返す */
function tryReplaceRef(value: unknown, kind: EntityKind, projLookup: LookupTable): unknown {
  if (typeof value !== "string") return value;
  if (!UUID_PATTERN.test(value)) return value;
  const m = projLookup[kind];
  if (!m) return value;
  return m.get(value) ?? value;
}

/**
 * 文字列値が `<UUID><suffix>` 形式 (例: "abc...123.design.json") の場合、
 * 先頭 UUID 部分を全 kind 横断 flat lookup で kebab-case id に置換する。
 * Screen.designFileRef / puckDataRef / thumbnailRef 等の file path 形式に対応。
 */
function tryReplaceUuidFilename(value: unknown, projLookup: LookupTable): unknown {
  if (typeof value !== "string") return value;
  const m = value.match(/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\..+)$/);
  if (!m) return value;
  const uuid = m[1];
  const suffix = m[2];
  const flat = buildFlatLookup(projLookup);
  const entry = flat.get(uuid);
  if (!entry) return value;
  return `${entry.id}${suffix}`;
}

/**
 * template string 内の `@<kind>.<UUID>...` パターンの UUID 部分を kebab-case id に置換。
 * argumentMapping / runIf 等の expression 形式で screen/table 等を参照する場合に対応。
 * 1 文字列内に複数出現可。
 */
function replaceTemplateUuids(
  value: string,
  projLookup: LookupTable,
  unknownUuids: Set<string>,
): string {
  return value.replace(
    /@([a-zA-Z]+)\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/g,
    (match, prefix: string, uuid: string) => {
      const kind = TEMPLATE_PREFIX_TO_KIND[prefix];
      if (!kind) return match;
      const m = projLookup[kind];
      if (!m) return match;
      const newId = m.get(uuid);
      if (!newId) {
        unknownUuids.add(uuid);
        return match;
      }
      return `@${prefix}.${newId}`;
    },
  );
}

/**
 * description 等のフリーテキスト内に embed された素の UUID を kebab-case id に置換する。
 * mapping にあるものだけ置換、無い UUID は触らない (誤爆防止)。
 * UUID v4 pattern は厳密なので、UUID パターン外の偶然の hex 列を誤置換しない。
 */
function replacePlainUuidsInText(value: string, projLookup: LookupTable): string {
  const flat = buildFlatLookup(projLookup);
  return value.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g,
    (uuid) => {
      const entry = flat.get(uuid);
      return entry ? entry.id : uuid;
    },
  );
}

interface WalkContext {
  pathStack: string[];
  unknownUuids: Set<string>;
  projLookup: LookupTable;
}

/** 再帰的に object を walk し、既知 ref field の UUID を置換 */
function walkAndReplace(node: unknown, ctx: WalkContext): unknown {
  if (Array.isArray(node)) {
    return node.map((v) => walkAndReplace(v, ctx));
  }
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      ctx.pathStack.push(k);

      // uuid field は保持 (touch しない、record 用)
      if (k === "uuid") {
        out[k] = v;
        ctx.pathStack.pop();
        continue;
      }

      // id field が entity 自身の identifier (root id / meta.id) の場合は string 置換系を全て skip。
      // migrateEntityFile が後段で swap する。判定: 直前 pathStack が空 (root直下) または "meta" のみ
      //  (ProcessFlow.meta.id) の場合に限定。argumentMapping.id 等は通常の string 処理を通す。
      if (k === "id") {
        const parentDepth = ctx.pathStack.length - 1; // 自身を除く深さ
        const parentIsRoot = parentDepth === 0;
        const parentIsMeta = parentDepth === 1 && ctx.pathStack[0] === "meta";
        if (parentIsRoot || parentIsMeta) {
          out[k] = v;
          ctx.pathStack.pop();
          continue;
        }
        // それ以外の id は通常の string 処理 (argumentMapping.id 等)
      }

      // assignments object: header/sidebar/footer/... 値は Screen UUID
      if (k === "assignments" && isPlainObject(v)) {
        const newAssign: Record<string, unknown> = {};
        for (const [regionKey, regionVal] of Object.entries(v)) {
          newAssign[regionKey] = tryReplaceRef(regionVal, "screen", ctx.projLookup);
          if (typeof regionVal === "string" && UUID_PATTERN.test(regionVal)) {
            const replaced = newAssign[regionKey];
            if (replaced === regionVal) ctx.unknownUuids.add(regionVal);
          }
        }
        out[k] = newAssign;
        ctx.pathStack.pop();
        continue;
      }

      // 既知 ref field
      if (k in REF_FIELD_TO_KIND && typeof v === "string" && UUID_PATTERN.test(v)) {
        const refKind = REF_FIELD_TO_KIND[k];
        const replaced = tryReplaceRef(v, refKind, ctx.projLookup);
        if (replaced === v) ctx.unknownUuids.add(v);
        out[k] = replaced;
        ctx.pathStack.pop();
        continue;
      }

      // 既知 array ref field (例: dependencies / tableIds)
      if (k in ARRAY_REF_FIELD_TO_KIND && Array.isArray(v)) {
        const refKind = ARRAY_REF_FIELD_TO_KIND[k];
        const flat = refKind === null ? buildFlatLookup(ctx.projLookup) : null;
        out[k] = v.map((item) => {
          if (typeof item !== "string" || !UUID_PATTERN.test(item)) return item;
          if (refKind === null) {
            const entry = flat!.get(item);
            if (!entry) {
              ctx.unknownUuids.add(item);
              return item;
            }
            return entry.id;
          }
          const replaced = tryReplaceRef(item, refKind, ctx.projLookup);
          if (replaced === item) ctx.unknownUuids.add(item);
          return replaced;
        });
        ctx.pathStack.pop();
        continue;
      }

      // 文字列値の連鎖置換: file path 形式 → template string → 素の UUID
      if (typeof v === "string") {
        // file path 形式 (UUID + ".design.json" 等)
        // Screen.design.designFileRef / puckDataRef / thumbnailRef、PageLayout.design.designFileRef 等
        const replacedPath = tryReplaceUuidFilename(v, ctx.projLookup);
        if (replacedPath !== v) {
          out[k] = replacedPath;
          ctx.pathStack.pop();
          continue;
        }
        // template string 内 `@<kind>.<UUID>...` 形式の置換 (argumentMapping / runIf 等)
        const replacedTemplate = replaceTemplateUuids(v, ctx.projLookup, ctx.unknownUuids);
        if (replacedTemplate !== v) {
          out[k] = replacedTemplate;
          ctx.pathStack.pop();
          continue;
        }
        // description / comment 等のフリーテキスト内 plain UUID の置換
        // (mapping にあるもののみ置換、誤爆防止)
        const replacedText = replacePlainUuidsInText(v, ctx.projLookup);
        if (replacedText !== v) {
          out[k] = replacedText;
          ctx.pathStack.pop();
          continue;
        }
      }

      // root id / meta.id は entity 自身の id (apply 時に外部 swap で書換)
      // ここでは触らない
      out[k] = walkAndReplace(v, ctx);
      ctx.pathStack.pop();
    }
    return out;
  }
  return node;
}

/** entity file: id ↔ uuid swap + ref 置換 + ファイル rename を実行 */
function migrateEntityFile(
  filePath: string,
  kind: EntityKind,
  projLookup: LookupTable,
  unknownUuids: Set<string>,
): { from: string; to: string } | null {
  const data = readJson<Record<string, unknown>>(filePath);

  // 1) ref 置換 (recursive walk)
  const ctx: WalkContext = { pathStack: [], unknownUuids, projLookup };
  const replaced = walkAndReplace(data, ctx) as Record<string, unknown>;

  // 2) root id / meta.id を kebab-case id に swap、uuid field に旧 UUID を保管
  const m = projLookup[kind];
  if (!m) {
    throw new Error(`projLookup[${kind}] が未定義: ${filePath}`);
  }

  let oldUuid: string;
  let newId: string;

  if (kind === "processFlow") {
    const meta = isPlainObject(replaced["meta"]) ? (replaced["meta"] as Record<string, unknown>) : {};
    oldUuid = typeof meta["id"] === "string" ? (meta["id"] as string) : "";
    const lookupId = m.get(oldUuid);
    if (!lookupId) {
      throw new Error(`mapping に未登録: ${kind} uuid=${oldUuid} (file=${filePath})`);
    }
    newId = lookupId;
    meta["id"] = newId;
    meta["uuid"] = oldUuid;
    replaced["meta"] = meta;
  } else {
    oldUuid = typeof replaced["id"] === "string" ? (replaced["id"] as string) : "";
    const lookupId = m.get(oldUuid);
    if (!lookupId) {
      throw new Error(`mapping に未登録: ${kind} uuid=${oldUuid} (file=${filePath})`);
    }
    newId = lookupId;
    replaced["id"] = newId;
    replaced["uuid"] = oldUuid;
  }

  // 3) field 順序を整える: id, uuid, name, ... の順 (EntityMeta required)
  const ordered = reorderEntity(replaced, kind);

  // 4) 書き戻し
  if (!dryRun) {
    writeJson(filePath, ordered);
  }

  // 5) ファイル名 rename
  const dir = dirname(filePath);
  const baseName = basename(filePath);
  const newBaseName = `${newId}.json`;
  const newPath = join(dir, newBaseName);

  if (baseName !== newBaseName) {
    if (!dryRun) {
      renameSync(filePath, newPath);
    }
    const oldDesign = filePath.replace(/\.json$/, ".design.json");
    const newDesign = newPath.replace(/\.json$/, ".design.json");
    if (existsSync(oldDesign)) {
      if (!dryRun) renameSync(oldDesign, newDesign);
    }
    return { from: baseName, to: newBaseName };
  }
  return null;
}

/** entity root の field 順序を整える: id, uuid, name を先頭に */
function reorderEntity(obj: Record<string, unknown>, kind: EntityKind): Record<string, unknown> {
  if (kind === "processFlow") {
    const meta = isPlainObject(obj["meta"]) ? (obj["meta"] as Record<string, unknown>) : null;
    if (meta) {
      const orderedMeta: Record<string, unknown> = {};
      for (const k of ["id", "uuid", "name", "description", "flowType", "maturity"]) {
        if (k in meta) orderedMeta[k] = meta[k];
      }
      for (const [k, v] of Object.entries(meta)) {
        if (!(k in orderedMeta)) orderedMeta[k] = v;
      }
      obj["meta"] = orderedMeta;
    }
    return obj;
  }
  const ordered: Record<string, unknown> = {};
  if ("$schema" in obj) ordered["$schema"] = obj["$schema"];
  for (const k of ["id", "uuid", "name", "description"]) {
    if (k in obj) ordered[k] = obj[k];
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in ordered)) ordered[k] = v;
  }
  return ordered;
}

/** harmony.json の entities + workspace meta を更新 */
function migrateHarmonyJson(
  projectId: string,
  mapKey: string,
  projLookup: LookupTable,
  unknownUuids: Set<string>,
): void {
  const harmonyPath = join(projectRootDir(projectId), "harmony.json");
  if (!existsSync(harmonyPath)) return;
  const data = readJson<Record<string, unknown>>(harmonyPath);

  const ctx: WalkContext = { pathStack: [], unknownUuids, projLookup };

  // 1) ref 置換 (recursive walk)
  const walked = walkAndReplace(data, ctx) as Record<string, unknown>;

  // 2) entities.<kind>[].id (kind 別 lookup で置換)
  const entities = isPlainObject(walked["entities"]) ? walked["entities"] : undefined;
  if (entities) {
    for (const [kindKeyStr, arr] of Object.entries(entities)) {
      if (!Array.isArray(arr)) continue;
      const kind = (Object.entries(KIND_TO_ENTITIES_KEY).find(
        ([, v]) => v === kindKeyStr,
      )?.[0] ?? null) as EntityKind | null;
      if (!kind) continue;
      for (const entry of arr as Array<Record<string, unknown>>) {
        if (kind === "processFlow" && typeof entry["kind"] === "string") {
          if (typeof entry["flowType"] !== "string") entry["flowType"] = entry["kind"];
          delete entry["kind"];
        }
        const m = projLookup[kind];
        if (!m) continue;
        const oldId = typeof entry["id"] === "string" ? (entry["id"] as string) : "";
        if (UUID_PATTERN.test(oldId)) {
          const newId = m.get(oldId);
          if (newId) {
            entry["id"] = newId;
          } else {
            unknownUuids.add(oldId);
          }
        }
      }
    }
  }

  // 3) workspace meta: meta.id を project id (= ディレクトリ名) に統一
  //    旧 UUID は meta.uuid に保管。field 順序も id/uuid/name/... に整える。
  const meta = isPlainObject(walked["meta"]) ? (walked["meta"] as Record<string, unknown>) : null;
  if (meta) {
    const metaId = typeof meta["id"] === "string" ? (meta["id"] as string) : "";
    if (UUID_PATTERN.test(metaId)) {
      meta["uuid"] = metaId;
      meta["id"] = projectId;
    } else if (projectId !== mapKey && metaId === mapKey) {
      meta["id"] = projectId;
    }
    const orderedMeta: Record<string, unknown> = {};
    for (const k of ["id", "uuid", "name", "description", "version", "mode", "maturity"]) {
      if (k in meta) orderedMeta[k] = meta[k];
    }
    for (const [k, v] of Object.entries(meta)) {
      if (!(k in orderedMeta)) orderedMeta[k] = v;
    }
    walked["meta"] = orderedMeta;
  }

  if (!dryRun) {
    writeJson(harmonyPath, walked);
  }
}

/** screen-flow-positions.json の positions キー (Screen + ScreenGroup UUID) を置換 */
function migrateScreenFlowPositions(
  projectId: string,
  projLookup: LookupTable,
  unknownUuids: Set<string>,
): void {
  const flowPath = join(projectRootDir(projectId), "harmony", "screen-flow-positions.json");
  if (!existsSync(flowPath)) return;
  const data = readJson<Record<string, unknown>>(flowPath);
  const positions = isPlainObject(data["positions"]) ? data["positions"] : null;
  if (!positions) return;

  const newPositions: Record<string, unknown> = {};
  const flat = buildFlatLookup(projLookup);
  for (const [uuid, val] of Object.entries(positions)) {
    if (UUID_PATTERN.test(uuid)) {
      const entry = flat.get(uuid);
      if (entry) {
        newPositions[entry.id] = val;
      } else {
        newPositions[uuid] = val;
        unknownUuids.add(uuid);
      }
    } else {
      newPositions[uuid] = val;
    }
  }
  data["positions"] = newPositions;

  if (!dryRun) {
    writeJson(flowPath, data);
  }
}

function applyPhase(): void {
  if (!existsSync(mappingPath)) {
    console.error(`mapping file not found: ${mappingPath}\n--prepare で生成してください。`);
    process.exit(1);
  }
  const mapping = readJson<Mapping>(mappingPath);
  validateMapping(mapping);

  const projects = targetProjectRoot
    ? [{ projectId: targetProjectId!, mapKey: targetMappingKey! }]
    : targetProject
      ? [{ projectId: targetProject, mapKey: targetProject }]
      : Object.keys(mapping).map((projectId) => ({ projectId, mapKey: projectId }));

  for (const { projectId, mapKey } of projects) {
    const projMap = mapping[mapKey];
    if (!projMap) {
      console.warn(`(skip) ${projectId}: mapping key "${mapKey}" にエントリ無し`);
      continue;
    }
    const projLookup = buildProjectLookup(projMap);
    const unknownUuids = new Set<string>();
    const harmonyDir = projectHarmonyDir(projectId);

    console.log(`\n=== ${projectId} (mapping: ${mapKey}) ===`);

    // 1) 各 entity file (7 kind、screenGroup は file 無し)
    let renamedCount = 0;
    for (const kind of ENTITY_KINDS) {
      if (kind === "screenGroup") continue;
      const files = listEntityFiles(harmonyDir, KIND_DIR[kind]);
      for (const file of files) {
        const data = readJson<Record<string, unknown>>(file);
        let entityUuid: string | undefined;
        if (kind === "processFlow") {
          const meta = isPlainObject(data["meta"]) ? data["meta"] : null;
          entityUuid = typeof meta?.["id"] === "string" ? (meta["id"] as string) : undefined;
        } else {
          entityUuid = typeof data["id"] === "string" ? (data["id"] as string) : undefined;
        }
        if (!entityUuid || !UUID_PATTERN.test(entityUuid)) {
          // 既に kebab、ref 置換のみ
          const ctx: WalkContext = { pathStack: [], unknownUuids, projLookup };
          const replaced = walkAndReplace(data, ctx);
          if (!dryRun) writeJson(file, replaced);
          continue;
        }
        const result = migrateEntityFile(file, kind, projLookup, unknownUuids);
        if (result) {
          renamedCount += 1;
          console.log(`  [${kind}] ${result.from} → ${result.to}`);
        }
      }
    }

    // 2) harmony.json
    migrateHarmonyJson(projectId, mapKey, projLookup, unknownUuids);

    // 3) screen-flow-positions.json
    migrateScreenFlowPositions(projectId, projLookup, unknownUuids);

    console.log(`  renamed files: ${renamedCount}`);
    if (unknownUuids.size > 0) {
      console.warn(`  ⚠ mapping にない UUID 検出 (${unknownUuids.size} 件):`);
      for (const u of Array.from(unknownUuids).slice(0, 20)) {
        console.warn(`    ${u}`);
      }
      if (unknownUuids.size > 20) console.warn(`    ... (+${unknownUuids.size - 20} more)`);
    }
  }

  if (dryRun) {
    console.log("\n(dry-run mode: no files were modified)");
  }
}

// ─── エントリポイント ────────────────────────────────────────────────────────

if (prepareMode) {
  preparePhase();
} else {
  applyPhase();
}
