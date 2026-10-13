/**
 * rename の、参照の書き換え (独自部品の差し込み口の画面 ID・harmony.json の一覧・画面フロー / ER 図の座標・汎用定義のパス参照)。
 * renameEntity.ts から分離した、状態を持たない関数群。
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { layoutComponentsFile } from "./projectStorage.js";
import type { RenameEntityType } from "./renameTypes.js";
import { ENTITY_PRIMARY_DIR, escapeJsonPointerToken, readFileContentOrNull } from "./renameCommon.js";

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * 独自部品の差し込み口のうち、種類が「画面」(`kind: "screen"`) のものに入れた画面 ID を、画面の改名に追従させる。
 *
 * - 画面の部品の木 (`layout.nodes`) の component ノードの `args[<差し込み口 ID>]`
 * - 独自部品の定義 (`layout-components.json`) の、差し込み口の既定値と、定義の中の component ノードの `args`
 *   (定義の部品の木にある `screenRef` の文字そのものは、汎用の走査が更新する)
 * 差し込み口の種類は、独自部品の定義が宣言している。種類が「文言」「項目」の差し込み値は触れない。
 */
export type ComponentParamKinds = Map<string, Map<string, string>>; // 部品 ID → (差し込み口 ID → 種類)

export function paramKindsOf(components: unknown): ComponentParamKinds {
  const out: ComponentParamKinds = new Map();
  for (const c of Array.isArray(components) ? components : []) {
    if (!isPlainObject(c) || typeof c.id !== "string") continue;
    const kinds = new Map<string, string>();
    for (const p of Array.isArray(c.params) ? c.params : []) if (isPlainObject(p) && typeof p.id === "string" && typeof p.kind === "string") kinds.set(p.id, p.kind);
    out.set(c.id, kinds);
  }
  return out;
}

export function rewriteNodesScreenArgs(
  nodes: unknown, pointer: string, kinds: ComponentParamKinds, oldId: string, newId: string, onMatch: (jsonPointer: string) => void,
): unknown {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((n, i) => {
    if (!isPlainObject(n)) return n;
    const here = `${pointer}/${i}`;
    let next: Record<string, unknown> = n;
    if (n.type === "component" && typeof n.componentRef === "string" && isPlainObject(n.args)) {
      const paramKinds = kinds.get(n.componentRef);
      let args: Record<string, unknown> | null = null;
      for (const [k, v] of Object.entries(n.args)) {
        if (v === oldId && paramKinds?.get(k) === "screen") {
          args = args ?? { ...n.args };
          args[k] = newId;
          onMatch(`${here}/args/${escapeJsonPointerToken(k)}`);
        }
      }
      if (args) next = { ...next, args };
    }
    if (Array.isArray(n.children)) {
      const children = rewriteNodesScreenArgs(n.children, `${here}/children`, kinds, oldId, newId, onMatch);
      if (children !== n.children) next = { ...next, children };
    }
    return next;
  });
}

/** 独自部品の定義 (layout-components.json) から、差し込み口の種類を読む。ファイルが無ければ空 */
export async function loadComponentParamKinds(dataRoot: string): Promise<ComponentParamKinds> {
  const raw = await readFileContentOrNull(path.join(dataRoot, "layout-components.json"));
  if (raw === null) return new Map();
  try {
    const doc = JSON.parse(raw) as unknown;
    return paramKindsOf(isPlainObject(doc) ? doc.components : undefined);
  } catch {
    return new Map(); // 壊れていれば、事前確認 (assertReferenceSourcesReadable) が止める
  }
}

/** 画面ファイルの layout.nodes を処理する (独自部品の定義は kinds で渡す) */
export function rewriteComponentScreenArgs(
  screen: unknown, kinds: ComponentParamKinds, oldId: string, newId: string, onMatch: (jsonPointer: string) => void,
): unknown {
  if (!isPlainObject(screen) || !isPlainObject(screen.layout)) return screen;
  const nodes = rewriteNodesScreenArgs(screen.layout.nodes, "/layout/nodes", kinds, oldId, newId, onMatch);
  return nodes === screen.layout.nodes ? screen : { ...screen, layout: { ...screen.layout, nodes } };
}

/** layout-components.json (独自部品の定義) を処理する */
export function rewriteLayoutComponentsScreenRefs(
  doc: unknown, kinds: ComponentParamKinds, oldId: string, newId: string, onMatch: (jsonPointer: string) => void,
): unknown {
  if (!isPlainObject(doc) || !Array.isArray(doc.components)) return doc;
  const components = doc.components.map((c, ci) => {
    if (!isPlainObject(c)) return c;
    let next: Record<string, unknown> = c;
    // 差し込み口の既定値
    if (Array.isArray(c.params)) {
      let changed = false;
      const params = c.params.map((p, pi) => {
        if (isPlainObject(p) && p.kind === "screen" && p.default === oldId) {
          changed = true;
          onMatch(`/components/${ci}/params/${pi}/default`);
          return { ...p, default: newId };
        }
        return p;
      });
      if (changed) next = { ...next, params };
    }
    // 定義の中の、他の独自部品の使い方 (component ノードの args)
    const nodes = rewriteNodesScreenArgs(c.nodes, `/components/${ci}/nodes`, kinds, oldId, newId, onMatch);
    if (nodes !== c.nodes) next = { ...next, nodes };
    return next;
  });
  return { ...doc, components };
}

// ── specialized handlers (M-4): KEY / entry self-id ─────────────────────────

/** entityType → harmony.json `entities.<kind>[]` array key 名 mapping */
const ENTITY_TYPE_TO_HARMONY_KIND_KEY: Record<RenameEntityType, string> = {
  screen: "screens",
  table: "tables",
  processFlow: "processFlows",
  sequence: "sequences",
  view: "views",
  viewDefinition: "viewDefinitions",
  pageLayout: "pageLayouts",
};

/**
 * harmony.json の `entities.<kind>[].id` を新 id に書き換える (KEY ではなく entry 自身の id field)。
 *
 * 汎用 walker は scalar `id` field を rename 対象 entity に紐付けて識別できないため、本専用 handler
 * で `entities.<kind>` 配下に限定して `id === oldId` を検出 + 置換する。
 *
 * 注: ScreenTransition の `sourceScreenId` / `targetScreenId` は SCALAR_REF_FIELDS で
 * 既に拾われるため、ここでは扱わない (汎用 walker 側で処理)。
 */
export function rewriteHarmonyEntitiesId(
  data: unknown,
  entityType: RenameEntityType,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  const entities = obj.entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) return data;
  const ent = entities as Record<string, unknown>;
  const kindKey = ENTITY_TYPE_TO_HARMONY_KIND_KEY[entityType];
  const arr = ent[kindKey];
  if (!Array.isArray(arr)) return data;

  let mutated = false;
  const newArr = arr.map((entry, i) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>;
      if (e.id === oldId) {
        mutated = true;
        onMatch(`/entities/${escapeJsonPointerToken(kindKey)}/${i}/id`);
        return { ...e, id: newId };
      }
    }
    return entry;
  });

  if (!mutated) return data;
  return { ...obj, entities: { ...ent, [kindKey]: newArr } };
}

/**
 * screen-flow-positions.json の `positions[oldId]` (object KEY) と `positions[oldId].* ` の
 * 値を新 id に migrate する。Screen rename 専用 (他 entity は positions に含まれない)。
 *
 * KEY 走査のため walker (VALUE 一致のみ) では捕捉できない。
 */
export function rewriteScreenFlowPositionsKeys(
  data: unknown,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
  onCollision?: (message: string) => void,
): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  const positions = obj.positions;
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) return data;
  const p = positions as Record<string, unknown>;
  if (!(oldId in p)) return data;
  // newId 既存衝突は preview の uniqueOk で検出済 (同 entity 内 unique 保証)
  // ただし screen-flow-positions は ScreenGroup id も同 propertyNames に並ぶため、念のため検査
  if (newId in p) {
    // 既に存在 — Phase I round 3+4 Must-fix D: 旧実装は silent skip + warning だったが、
    // 当該 entry の座標が orphan 化する data corruption リスクを優先し blocker に格上げ。
    // 設計者は先に stale entry を手動で除去してから rename 再実行する責務を負う。
    onCollision?.(
      `screen-flow-positions.json: positions に旧 id "${oldId}" と新 id "${newId}" が同時存在 — ` +
      `KEY 衝突。先に stale entry "${oldId}" または "${newId}" を手動で削除してください。`,
    );
    return data;
  }
  onMatch(`/positions/${escapeJsonPointerToken(oldId)}`);
  const { [oldId]: moved, ...rest } = p;
  return { ...obj, positions: { ...rest, [newId]: moved } };
}

/**
 * er-layout.json の `positions[oldId]` (object KEY) を新 id に migrate する。
 * Phase F M-2 (Codex 独立レビュー)。Table rename 専用。
 *
 * `logicalRelations[].sourceTableId` / `.targetTableId` は SCALAR_REF_FIELDS で汎用 walker が
 * 拾うため、ここでは扱わない (object KEY のみ専用 handler)。
 */
export function rewriteErLayoutPositionsKeys(
  data: unknown,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
  onCollision?: (message: string) => void,
): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  const positions = obj.positions;
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) return data;
  const p = positions as Record<string, unknown>;
  if (!(oldId in p)) return data;
  if (newId in p) {
    // Phase I round 3+4 Must-fix D: 旧実装は silent skip + warning だったが、blocker に格上げ。
    // 当該 entry の座標が orphan 化する data corruption リスクを優先する。
    onCollision?.(
      `er-layout.json: positions に旧 id "${oldId}" と新 id "${newId}" が同時存在 — ` +
      `KEY 衝突。先に stale entry "${oldId}" または "${newId}" を手動で削除してください。`,
    );
    return data;
  }
  onMatch(`/positions/${escapeJsonPointerToken(oldId)}`);
  const { [oldId]: moved, ...rest } = p;
  return { ...obj, positions: { ...rest, [newId]: moved } };
}

/**
 * Phase I round 3+4 Must-fix E (Antigravity M-6): generic-definitions の `ref` field 内に
 * 記述される top-level entity への path 形式参照 (例: "tables/transactions",
 * "screens/dashboard") を rename target に合わせて更新する。
 *
 * 対応形式: `<entity-primary-dir>/<oldId>` のみ (exact match)。
 * generic-definitions 内の `generic-definitions/<kind>/<name>` 形式自己参照は
 * top-level 7 entity rename の対象外なので touch しない (本 ISSUE は top-level entity 限定)。
 *
 * walker は再帰的に object を走査し、key === "ref" かつ value === expected path string の
 * 場合のみ置換する。複合 ref (object 内 sub-ref 等) や別 field 名は touch しない。
 */
export function rewriteGenericDefinitionPathRefs(
  data: unknown,
  entityType: RenameEntityType,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
): unknown {
  const dir = ENTITY_PRIMARY_DIR[entityType];
  const oldRef = `${dir}/${oldId}`;
  const newRef = `${dir}/${newId}`;

  function walk(node: unknown, pointer: string): unknown {
    if (node === null || node === undefined || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      return node.map((v, i) => walk(v, `${pointer}/${i}`));
    }
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      const childPointer = `${pointer}/${escapeJsonPointerToken(key)}`;
      if (key === "ref" && typeof v === "string" && v === oldRef) {
        onMatch(childPointer);
        out[key] = newRef;
        continue;
      }
      out[key] = walk(v, childPointer);
    }
    return out;
  }

  return walk(data, "");
}

