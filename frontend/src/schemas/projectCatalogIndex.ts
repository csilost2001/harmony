/**
 * Project Catalog Index — workspace 全体の catalog lookup index (#1269 提案 C)。
 *
 * `processFlowAntipatternValidator` の Check 31 (BROKEN_REFERENCE_MATURITY_AWARE) を
 * `@var` / `@event` の 2 prefix から 24 prefix 全体に拡張するために必要な、project 全体の
 * catalog 突合用 lookup index。
 *
 * docs/spec/process-flow-prefix-system.md §1 の 24 prefix table と対応する。各 entry は
 * 「head 識別子の存在」のみを Set で持つ (深 path 検証は path 解析と組合せで実施)。
 *
 * 用途:
 *   - validate-samples CLI / vitest が build して checkAntipatterns に渡す
 *   - 将来 UI 側で live validation する際は workspace store から build する想定
 *     (本 PR では未実装、Phase D follow-up または #1269 完了後の別 ISSUE)
 *
 * 不明 / 未渡 (undefined) の場合は当該 prefix の broken-ref 検出を silent pass にする
 * (Phase X2 の既存挙動互換)。
 */

/**
 * 24 prefix 別 lookup index。各 prefix の head 識別子集合を持つ。
 *
 * 深 path lookup ([entity-id] → [child-id] の 2 段) は entity prefix のみ Map で実装。
 * generic-definition / catalog 系 prefix は単純な Set lookup で済む (head=name で完結)。
 */
export interface ProjectCatalogIndex {
  // ─── Entity prefixes (深 path 検証あり) ───────────────────────────────────
  /** Map<screenId, Set<itemId>> — `@screen.<screenId>` の存在 + `@screen.<screenId>.item.<itemId>` */
  screens: Map<string, Set<string>>;
  /** Map<tableId, Set<fieldId>> — `@table.<tableId>` + `@table.<tableId>.field.<fieldId>` */
  tables: Map<string, Set<string>>;
  /** Map<viewId, Set<fieldId>> — `@view.<viewId>` + `@view.<viewId>.field.<fieldId>` */
  views: Map<string, Set<string>>;
  /** Map<viewerId, Set<columnId>> — `@viewer.<viewerId>` + `@viewer.<viewerId>.column.<columnId>` */
  viewers: Map<string, Set<string>>;

  // ─── Entity prefixes (単純 ID lookup) ────────────────────────────────────
  /** `@layout.<layoutId>` */
  layouts: Set<string>;
  /** `@seq.<seqId>` */
  sequences: Set<string>;
  /** `@flow.<flowId>` */
  flows: Set<string>;
  /** `@system.<systemId>` (externalSystems catalog) */
  externalSystems: Set<string>;

  // ─── Generic Definition Catalog (#1090 / #1267 Phase X2 14 kind + #1303 3 kind = 17 kind + #1310 1 kind = 18 kind) ───
  /** `@contract.<name>` — data-contract */
  dataContracts: Set<string>;
  /** `@type.<name>` — domain-type */
  domainTypes: Set<string>;
  /** `@exception.<name>` — exception-type */
  exceptionTypes: Set<string>;
  /** `@rule.<name>` — application-rule */
  applicationRules: Set<string>;
  /** `@validation.<name>` — validation-rule */
  validationRules: Set<string>;
  /** `@behavior.<name>` — ui-behavior */
  uiBehaviors: Set<string>;
  /** `@policy.<name>` — runtime-policy */
  runtimePolicies: Set<string>;
  /** `@component.<name>` — component-definition */
  componentDefinitions: Set<string>;
  /** `@dialog.<name>` — dialog (#1303) */
  dialogs: Set<string>;
  /** `@messageArea.<name>` — message-area (#1303、#1318 で kind=kebab `message-area` / prefix=camelCase `messageArea` に分離) */
  messageAreas: Set<string>;
  /** `@options.<name>` — options (#1303) */
  optionSets: Set<string>;
  /** `@var.global.<key>` — global (#1310、workspace/project 横断 mutable 設定 slot) */
  globals: Set<string>;

  /**
   * `@const.<key>` — constants catalog (#1267 Phase X2)。
   * Set には constants catalog instance 名 (例: "OrderConstants") + 全 catalog の fields[].name
   * の union を入れる (`@const.OrderConstants` も `@const.TAX_RATE` も valid と扱う)。
   */
  constants: Set<string>;
  /** `@msg.<key>` — message catalog (catalog name + field name union) */
  messages: Set<string>;
  /** `@event.<topic>` — domain-event (catalog name + field name union、`@var.event` の context catalog とは別物) */
  domainEvents: Set<string>;
  /** `@logEvent.<key>` — log-event */
  logEvents: Set<string>;
  /** `@logConfig.<key>` — log-config */
  logConfigs: Set<string>;

  // ─── Project-level catalogs ──────────────────────────────────────────────
  /** `@conv.<category>` — conventions catalog の top-level category キー集合 */
  conventionCategories: Set<string>;
  /** `@ext.<namespace>` — extensions namespace 集合 */
  extensionNamespaces: Set<string>;
}

/**
 * 空 (no-op) の index を作成。各 set / map が空のため、すべての参照は broken と判定される。
 * 主にテスト用 / projectIndex 未渡し時の fallback。
 *
 * 注意: `checkAntipatterns` には `projectIndex` が **undefined の場合 silent pass** という別 path
 * があり、空 index を渡すと「全 broken」と判定されてしまうので意味が変わる。
 */
export function createEmptyProjectCatalogIndex(): ProjectCatalogIndex {
  return {
    screens: new Map(),
    tables: new Map(),
    views: new Map(),
    viewers: new Map(),
    layouts: new Set(),
    sequences: new Set(),
    flows: new Set(),
    externalSystems: new Set(),
    dataContracts: new Set(),
    domainTypes: new Set(),
    exceptionTypes: new Set(),
    applicationRules: new Set(),
    validationRules: new Set(),
    uiBehaviors: new Set(),
    runtimePolicies: new Set(),
    componentDefinitions: new Set(),
    dialogs: new Set(),
    messageAreas: new Set(),
    optionSets: new Set(),
    globals: new Set(),
    constants: new Set(),
    messages: new Set(),
    domainEvents: new Set(),
    logEvents: new Set(),
    logConfigs: new Set(),
    conventionCategories: new Set(),
    extensionNamespaces: new Set(),
  };
}

// ─── Builder からの入力型 ────────────────────────────────────────────────────

interface ResourceWithId {
  id?: string;
}
interface ScreenLike extends ResourceWithId {
  items?: Array<{ id?: string }>;
}
interface TableLike extends ResourceWithId {
  fields?: Array<{ name?: string; id?: string }>;
  columns?: Array<{ name?: string; id?: string }>;
}
interface ViewLike extends ResourceWithId {
  fields?: Array<{ name?: string; id?: string }>;
  columns?: Array<{ name?: string; id?: string }>;
}
interface ViewDefinitionLike extends ResourceWithId {
  columns?: Array<{ id?: string; name?: string }>;
}
interface GenericDefinitionLike {
  kind?: string;
  name?: string;
  fields?: Array<{ name?: string }>;
}
interface ConventionsLike {
  [category: string]: unknown;
}
interface ExternalCatalogsLike {
  externalSystems?: Record<string, unknown>;
}

/** kind 名 → ProjectCatalogIndex の対応する Set property */
const GENERIC_KIND_TO_SET_KEY: Record<string, keyof ProjectCatalogIndex> = {
  "data-contract": "dataContracts",
  "domain-type": "domainTypes",
  "exception-type": "exceptionTypes",
  "application-rule": "applicationRules",
  "validation-rule": "validationRules",
  "ui-behavior": "uiBehaviors",
  "runtime-policy": "runtimePolicies",
  "component-definition": "componentDefinitions",
  constants: "constants",
  message: "messages",
  "domain-event": "domainEvents",
  "log-event": "logEvents",
  "log-config": "logConfigs",
  // #1303 — 3 新規 kind (#1318 で messageArea → message-area kebab-case 統一、prefix は camelCase 維持)
  dialog: "dialogs",
  "message-area": "messageAreas",
  options: "optionSets",
  // #1310 — global
  global: "globals",
};

/** conventions catalog の中で `@conv.<category>` として ref されない metadata field */
const CONVENTIONS_METADATA_KEYS = new Set(["$schema", "version", "description", "updatedAt"]);

export interface BuildProjectCatalogIndexInput {
  screens?: ScreenLike[];
  tables?: TableLike[];
  views?: ViewLike[];
  viewDefinitions?: ViewDefinitionLike[];
  pageLayouts?: ResourceWithId[];
  sequences?: ResourceWithId[];
  processFlows?: Array<{ meta?: { id?: string } } | { id?: string }>;
  genericDefinitions?: GenericDefinitionLike[];
  conventions?: ConventionsLike | null;
  externalCatalogs?: ExternalCatalogsLike | null;
  extensionNamespaces?: string[];
}

/**
 * 入力リソース群から ProjectCatalogIndex を build する。
 *
 * 渡されなかった (undefined) リソースは「ロードできなかった」として扱い、対応する Set / Map は
 * 空のままになる。**ただし checkAntipatterns 側で「index 自体が undefined」と「index 内の Set が空」
 * は別意味として扱う** (前者は silent pass、後者は全 broken)。本 PR では projectIndex を必ず一括
 * build して渡すため、build 時点で個別 set が空 = 当該 kind が project に存在しない、と表す。
 */
export function buildProjectCatalogIndex(input: BuildProjectCatalogIndexInput): ProjectCatalogIndex {
  const idx = createEmptyProjectCatalogIndex();

  // screens
  for (const s of input.screens ?? []) {
    if (typeof s.id === "string") {
      const itemIds = new Set<string>();
      for (const item of s.items ?? []) {
        if (typeof item?.id === "string") itemIds.add(item.id);
      }
      idx.screens.set(s.id, itemIds);
    }
  }

  // tables (column field 名は `name` 優先、`id` fallback — schema バージョンにより異なる)
  for (const t of input.tables ?? []) {
    if (typeof t.id === "string") {
      const fieldIds = new Set<string>();
      for (const f of t.fields ?? t.columns ?? []) {
        const fid = typeof f?.name === "string" ? f.name : f?.id;
        if (typeof fid === "string") fieldIds.add(fid);
      }
      idx.tables.set(t.id, fieldIds);
    }
  }

  // views
  for (const v of input.views ?? []) {
    if (typeof v.id === "string") {
      const fieldIds = new Set<string>();
      for (const f of v.fields ?? v.columns ?? []) {
        const fid = typeof f?.name === "string" ? f.name : f?.id;
        if (typeof fid === "string") fieldIds.add(fid);
      }
      idx.views.set(v.id, fieldIds);
    }
  }

  // view definitions (viewers)
  for (const vd of input.viewDefinitions ?? []) {
    if (typeof vd.id === "string") {
      const colIds = new Set<string>();
      for (const c of vd.columns ?? []) {
        const cid = typeof c?.id === "string" ? c.id : c?.name;
        if (typeof cid === "string") colIds.add(cid);
      }
      idx.viewers.set(vd.id, colIds);
    }
  }

  // layouts
  for (const l of input.pageLayouts ?? []) {
    if (typeof l.id === "string") idx.layouts.add(l.id);
  }

  // sequences
  for (const sq of input.sequences ?? []) {
    if (typeof sq.id === "string") idx.sequences.add(sq.id);
  }

  // flows
  for (const f of input.processFlows ?? []) {
    const id = (f as { meta?: { id?: string }; id?: string }).meta?.id ?? (f as { id?: string }).id;
    if (typeof id === "string") idx.flows.add(id);
  }

  // generic definitions (14 kind)
  for (const gd of input.genericDefinitions ?? []) {
    if (typeof gd.kind !== "string" || typeof gd.name !== "string") continue;
    const setKey = GENERIC_KIND_TO_SET_KEY[gd.kind];
    if (!setKey) continue;
    const target = idx[setKey] as Set<string>;
    target.add(gd.name);
    // constants / message / domain-event / log-event / log-config 系は field 名も flat key として登録
    if (
      gd.kind === "constants" ||
      gd.kind === "message" ||
      gd.kind === "domain-event" ||
      gd.kind === "log-event" ||
      gd.kind === "log-config"
    ) {
      for (const fld of gd.fields ?? []) {
        if (typeof fld?.name === "string") target.add(fld.name);
      }
    }
  }

  // conventions: top-level category keys + extensionCategories.<name> 両方を登録。
  // `@conv.numbering` (built-in) / `@conv.cefr` (plugin via extensionCategories) を等しく扱う。
  if (input.conventions) {
    for (const [key, value] of Object.entries(input.conventions)) {
      if (CONVENTIONS_METADATA_KEYS.has(key)) continue;
      if (key === "extensionCategories" && value && typeof value === "object") {
        // extensionCategories.{categoryName} 形式の plugin 拡張 category も `@conv.<name>` で参照可
        for (const subKey of Object.keys(value as Record<string, unknown>)) {
          idx.conventionCategories.add(subKey);
        }
        continue; // extensionCategories 自体は ref key として登録しない
      }
      idx.conventionCategories.add(key);
    }
  }

  // external systems
  if (input.externalCatalogs?.externalSystems) {
    for (const key of Object.keys(input.externalCatalogs.externalSystems)) {
      idx.externalSystems.add(key);
    }
  }

  // extension namespaces
  for (const ns of input.extensionNamespaces ?? []) {
    if (typeof ns === "string" && ns.length > 0) idx.extensionNamespaces.add(ns);
  }

  return idx;
}
