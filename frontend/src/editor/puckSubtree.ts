/**
 * puckSubtree.ts — 複合部品 (composite) の subtree 切出し / 展開ユーティリティ (#1412 P-4)。
 *
 * 純粋関数のみ (副作用なし、単体テスト容易)。frontend/AGENTS.md に従い JSX を持ち込まない。
 *
 * 取り扱う 2 系統 (調査確認済):
 *   - built-in primitive (Container/Row/Col/Card 等) は legacy `<DropZone zone="content">`
 *     → 子は `data.zones["<itemId>:<zoneName>"]` map に格納される。
 *   - 外部 component (#1411 P-3) は `{ type: "slot" }` field
 *     → 子は当該ノードの props に co-located で格納される (ノードごと自然に含まれる)。
 *
 * 設計方針: expand-on-drop "pattern" 方式 (GrapesJS customBlock 哲学)。
 * 複合部品を drop すると subtree がその場で展開挿入され、各ノードが個別編集可能になる。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 4.5
 */

import type { Data } from "@measured/puck";
import { regeneratePuckDataIds } from "./puckIdRegeneration";

type Content = Data["content"];
type Zones = NonNullable<Data["zones"]>;
type ComponentData = Content[number];

/** subtree 断片。自己完結した content + (legacy DropZone 用) zones サブセット。 */
export interface Subtree {
  content: Content;
  zones?: Zones;
}

/** 複合部品 placeholder ノードの type prefix。drop 直後に検出 → 展開される。 */
export const COMPOSITE_TYPE_PREFIX = "__composite__";

/** entry.id から複合部品 placeholder の Puck component type 名を作る。 */
export function compositeTypeName(id: string): string {
  return `${COMPOSITE_TYPE_PREFIX}${id}`;
}

/** Puck component type が複合部品 placeholder かどうか。 */
export function isCompositeType(type: string): boolean {
  return type.startsWith(COMPOSITE_TYPE_PREFIX);
}

/** 複合部品 placeholder type から元の entry.id を取り出す。 */
export function compositeIdFromType(type: string): string {
  return type.slice(COMPOSITE_TYPE_PREFIX.length);
}

/** ComponentData から props.id を安全に取り出す。 */
function itemId(item: ComponentData): string | undefined {
  const id = (item as { props?: { id?: unknown } }).props?.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * 指定 itemId をルートとする subtree (ルートノード + 全子孫) を自己完結 Data 断片に切り出す。
 *
 * - ルートノードは data.content から探す (現状の保存 UI は content 直下選択を前提)。
 * - legacy DropZone 系: `<itemId>:zone` キーを再帰的に辿り、subtree 内ノードに紐づく zones
 *   サブセットのみ収集する。
 * - slot 系: 子は props 同居なのでルートノードを含めれば自然に取り込まれる (追加収集不要)。
 *
 * 見つからない場合は null を返す。
 */
export function extractSubtree(data: Data, rootItemId: string): Subtree | null {
  const root = data.content.find((item) => itemId(item) === rootItemId);
  if (!root) return null;

  const allZones: Zones = data.zones ?? {};
  const collectedZones: Zones = {};

  // BFS で subtree 内の全 itemId を辿りつつ、紐づく zones サブセットを収集する。
  const queue: string[] = [rootItemId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    // この id を親 itemId に持つ zone キーをすべて収集する。
    for (const [zoneKey, zoneContent] of Object.entries(allZones)) {
      const sepIdx = zoneKey.indexOf(":");
      if (sepIdx < 0) continue;
      const parentId = zoneKey.slice(0, sepIdx);
      if (parentId !== id) continue;
      collectedZones[zoneKey] = zoneContent;
      // zone 内の子ノードを辿る (ネストした DropZone のため)。
      for (const child of zoneContent) {
        const childId = itemId(child);
        if (childId) queue.push(childId);
      }
    }
  }

  return {
    content: [root],
    ...(Object.keys(collectedZones).length > 0 ? { zones: collectedZones } : {}),
  };
}

/**
 * subtree に含まれる全ノードの type を列挙する (content + 全 zones)。
 */
export function collectSubtreeTypes(tree: Subtree): string[] {
  const types = new Set<string>();
  for (const item of tree.content) {
    const t = (item as { type?: unknown }).type;
    if (typeof t === "string") types.add(t);
  }
  if (tree.zones) {
    for (const zoneContent of Object.values(tree.zones)) {
      for (const item of zoneContent) {
        const t = (item as { type?: unknown }).type;
        if (typeof t === "string") types.add(t);
      }
    }
  }
  return [...types];
}

/**
 * subtree が内包する「依存部品」(= built-in primitive 以外の type) の一覧を返す (#1412 P-4)。
 *
 * built-in primitive は常に config に存在するため依存ではない。それ以外の type
 * (外部 component の entry.id 等) を dependencies として記録し、capability 6 判定に使う。
 * `builtinTypes` には config の built-in primitive type 名集合を渡す。
 */
export function collectDependencies(
  tree: Subtree,
  builtinTypes: Set<string>,
): string[] {
  return collectSubtreeTypes(tree).filter((t) => !builtinTypes.has(t));
}

/**
 * 1 つの複合部品 placeholder ノードを、その subtree に展開する (id 再生成済)。
 * `availableTypes` に含まれない type を持つ subtree 内ノードは error-card 型に差し替える。
 *
 * 戻り値: { content: 展開後 content ノード配列, zones: merge する zones サブセット }
 */
function expandOne(
  composite: ExpandableComposite,
  availableTypes: Set<string>,
): { content: Content; zones: Zones } {
  // subtree を Data 形に整形 → id 再生成 (props.id + zones キー itemId 同期)。
  const dataFragment: Data = {
    root: { props: {} },
    content: composite.tree.content,
    ...(composite.tree.zones ? { zones: composite.tree.zones } : {}),
  };
  const regenerated = regeneratePuckDataIds(dataFragment);

  const content = regenerated.content.map((item) =>
    guardNode(item, composite, availableTypes),
  );
  const zones: Zones = {};
  if (regenerated.zones) {
    for (const [zoneKey, zoneContent] of Object.entries(regenerated.zones)) {
      zones[zoneKey] = zoneContent.map((item) =>
        guardNode(item, composite, availableTypes),
      );
    }
  }
  return { content, zones };
}

/**
 * subtree 内ノードの type が config に無ければ missing-dependency error-card 型に差し替える。
 * error-card 型 (= `makeErrorCardConfig` が config に登録するキー) は別途 mergeComposite 側で
 * 登録される前提。ここでは type / props を error-card 用に書き換えるのみ。
 */
function guardNode(
  item: ComponentData,
  composite: ExpandableComposite,
  availableTypes: Set<string>,
): ComponentData {
  const type = (item as { type?: unknown }).type;
  if (typeof type === "string" && !availableTypes.has(type)) {
    return {
      type: composite.errorType,
      props: {
        id: itemId(item) ?? `${composite.errorType}-${type}`,
        missingType: type,
        compositeLabel: composite.label,
      },
    } as ComponentData;
  }
  return item;
}

/**
 * expandCompositePlaceholders に渡す複合部品の展開可能形。
 * - id: 複合部品の entry.id
 * - errorType: 依存欠落ノードを差し替える error-card の Puck component type 名
 *   (mergeCompositeComponents が config に登録するキーと一致させる)
 */
export interface ExpandableComposite {
  id: string;
  label: string;
  tree: Subtree;
  errorType: string;
}

/**
 * data 内の複合部品 placeholder ノードを subtree に展開する純粋・冪等関数 (#1412 P-4)。
 *
 * - content 直下の placeholder ノードを検出 → 該当 index に subtree (id 再生成済) を展開。
 *   zones サブセットは data.zones に merge する。
 * - 依存 type が `availableTypes` に無い subtree 内ノードは error-card 型に差し替える (capability 6)。
 * - placeholder が無ければ参照透過に同一構造を返す (冪等、無限ループ防止)。
 *
 * 注意: placeholder は content 直下にのみ現れる想定 (パレットからの drop は content 直下 or
 * DropZone 内だが、本実装では content 直下のみ展開する。DropZone 内 drop の展開は将来対応)。
 */
export function expandCompositePlaceholders(
  data: Data,
  composites: ExpandableComposite[],
  availableTypes: Set<string>,
): Data {
  const byType = new Map<string, ExpandableComposite>();
  for (const c of composites) {
    byType.set(compositeTypeName(c.id), c);
  }

  // content 直下に placeholder があるか判定 (冪等性のため早期 return)。
  const hasPlaceholder = data.content.some((item) => {
    const type = (item as { type?: unknown }).type;
    return typeof type === "string" && byType.has(type);
  });
  if (!hasPlaceholder) return data;

  const newContent: Content = [];
  const mergedZones: Zones = { ...(data.zones ?? {}) };

  for (const item of data.content) {
    const type = (item as { type?: unknown }).type;
    const composite = typeof type === "string" ? byType.get(type) : undefined;
    if (!composite) {
      newContent.push(item);
      continue;
    }
    // placeholder を subtree に展開 (その場挿入)。
    const expanded = expandOne(composite, availableTypes);
    newContent.push(...expanded.content);
    Object.assign(mergedZones, expanded.zones);
  }

  return {
    ...data,
    content: newContent,
    ...(Object.keys(mergedZones).length > 0 ? { zones: mergedZones } : {}),
  };
}
