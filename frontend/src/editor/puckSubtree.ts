/**
 * puckSubtree.ts — 複合部品 (composite) の subtree 切出し / 展開ユーティリティ (#1412 P-4)。
 *
 * 純粋関数のみ (副作用なし、単体テスト容易)。frontend/AGENTS.md に従い JSX を持ち込まない。
 *
 * 取り扱う 2 系統 (調査確認済):
 *   - built-in primitive (Container/Row/Col/Card 等) は legacy `<DropZone zone="content">`
 *     → 子は `data.zones["<itemId>:<zoneName>"]` map に格納される。
 *   - 外部 component (#1411 P-3) は `{ type: "slot" }` field
 *     → 子は当該ノードの props (`props.<slotName>` の Puck node 配列) に co-located で格納される。
 *
 * #1415 P2-2: 依存収集 (collectSubtreeTypes) と展開 (guardNode) は、slot 系の props 内 node 配列を
 * 再帰的に走査する。これにより slot 内に外部 component を含む複合部品でも、その nested 部品が
 * dependencies 収集に乗り、未ロード時の展開で missing-dependency error-card に差し替わる。
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
 * value が Puck node (= `{ type: string, props: object }`) かどうか (#1415 P2-2)。
 *
 * slot field (#1411 P-3) の子ノードは props.<slotName> の **配列** に co-located で格納される
 * (buildConfig.ts: `defaultProps[slot.name] = []`)。slot 名は manifest 依存でハードコードできない
 * ため、「props value が Puck node を要素に持つ配列」を generic に slot content とみなす。
 *
 * 誤検出 (業務 props がたまたま type/props を持つ) を避けるため、判定は puckIdRegeneration の
 * node 判定と同一形 (`type:string` かつ `props` が object) に揃える。
 */
function isPuckNode(value: unknown): value is ComponentData {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { props?: unknown }).props === "object" &&
    (value as { props?: unknown }).props !== null
  );
}

/** value が「Puck node を要素に持つ配列」(= slot content) かどうか。 */
function isSlotContentArray(value: unknown): value is ComponentData[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPuckNode);
}

/**
 * 1 ノードの props 内 slot content (= Puck node 配列) を列挙する (#1415 P2-2)。
 * 戻り値は [propName, childNode[]] のペア配列。
 */
function slotContentEntries(item: ComponentData): [string, ComponentData[]][] {
  const props = (item as { props?: Record<string, unknown> }).props;
  if (!props || typeof props !== "object") return [];
  const result: [string, ComponentData[]][] = [];
  for (const [key, value] of Object.entries(props)) {
    if (isSlotContentArray(value)) {
      result.push([key, value]);
    }
  }
  return result;
}

/**
 * ノード配列 (とその各ノードの props 内 slot content) を深さ優先で辿り、itemId 一致ノードを返す
 * (#1415 P2)。slot field (#1411 P-3) 内ノードは `props.<slotName>` 配列に co-located で格納される
 * ため、content / zones の浅い探索では見つからない。各ノードについて itemId 一致を確認し、無ければ
 * `slotContentEntries(node)` の各子配列を再帰探索する。
 */
function findNodeDeep(
  nodes: ComponentData[],
  id: string,
): ComponentData | undefined {
  for (const node of nodes) {
    if (itemId(node) === id) return node;
    for (const [, children] of slotContentEntries(node)) {
      const found = findNodeDeep(children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * 指定 itemId をルートとする subtree (ルートノード + 全子孫) を自己完結 Data 断片に切り出す。
 *
 * - ルートノードは data.content・**全 data.zones の各配列**・各ノードの props 内 slot content
 *   (#1411 P-3) を再帰的に deep-search して探す (S-2 / #1415 P2)。展開
 *   (expandCompositePlaceholders) が content / zones / slot props すべてに対応済なので、保存
 *   (切出し) も対称にいずれの階層のノード選択も受け付ける。content / zone 直下のみ探すと
 *   slot 内ノード選択で無音 null になり保存が失敗する。
 * - legacy DropZone 系: `<itemId>:zone` キーを再帰的に辿り、subtree 内ノードに紐づく zones
 *   サブセットのみ収集する。
 * - slot 系 (#1411 P-3): slot 直下の子ノード自体は props 同居なのでルートノードを含めれば
 *   自然に取り込まれる。ただし **その子が legacy DropZone (zones) を持つ場合** は、その
 *   `<childId>:zone` も別途収集しないと nested DropZone 内容が subtree から脱落する
 *   (#1415 P2-3)。slot 子孫ノードも走査対象に含めて zones を漏れなく収集する。
 *
 * 見つからない場合は null を返す。
 */
export function extractSubtree(data: Data, rootItemId: string): Subtree | null {
  const allZones: Zones = data.zones ?? {};
  // root を content 直下 → 全 zones の各配列 → (各ノードの slot props を再帰) の順で deep-search
  // する (S-2 / #1415 P2)。content / zones 内ノードの slot props も探索対象にする。
  let root: ComponentData | undefined = findNodeDeep(data.content, rootItemId);
  if (!root) {
    for (const zoneContent of Object.values(allZones)) {
      root = findNodeDeep(zoneContent, rootItemId);
      if (root) break;
    }
  }
  if (!root) return null;

  const collectedZones: Zones = {};

  // BFS で subtree 内の全ノードを辿りつつ、紐づく zones サブセットを収集する。
  // id だけでなく **node** を queue に積むことで、zone 由来の子ノード・slot props 由来の
  // 子ノード双方について「自身が持つ zones / slot」を漏れなく走査できる (#1415 P2-3)。
  const queue: ComponentData[] = [root];
  const seenIds = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    const id = itemId(node);
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      // この id を親 itemId に持つ legacy DropZone zone キーをすべて収集する。
      for (const [zoneKey, zoneContent] of Object.entries(allZones)) {
        const sepIdx = zoneKey.indexOf(":");
        if (sepIdx < 0) continue;
        const parentId = zoneKey.slice(0, sepIdx);
        if (parentId !== id) continue;
        collectedZones[zoneKey] = zoneContent;
        // zone 内の子ノードを辿る (ネストした DropZone のため)。zone 子も slot を持ちうる。
        for (const child of zoneContent) {
          queue.push(child);
        }
      }
    }
    // slot props 内の子ノードを辿る (#1415 P2-3)。slot 直下の子は subtree に co-located で
    // 含まれるが、その子が legacy zones を持つ場合の収集はここで queue に積むことで賄う。
    for (const [, children] of slotContentEntries(node)) {
      for (const child of children) {
        queue.push(child);
      }
    }
  }

  return {
    content: [root],
    ...(Object.keys(collectedZones).length > 0 ? { zones: collectedZones } : {}),
  };
}

/**
 * 1 ノードの type と、その props 内 slot content (#1411 P-3) を再帰的に types に収集する
 * (#1415 P2-2)。slot 内に外部 component を含む複合部品で、nested 部品が dependencies 収集から
 * 漏れるのを防ぐ。
 */
function collectNodeTypes(item: ComponentData, types: Set<string>): void {
  const t = (item as { type?: unknown }).type;
  if (typeof t === "string") types.add(t);
  // props 内 slot content (Puck node 配列) を再帰的に辿る。
  for (const [, children] of slotContentEntries(item)) {
    for (const child of children) {
      collectNodeTypes(child, types);
    }
  }
}

/**
 * subtree に含まれる全ノードの type を列挙する (content + 全 zones + props 内 slot content)。
 */
export function collectSubtreeTypes(tree: Subtree): string[] {
  const types = new Set<string>();
  for (const item of tree.content) {
    collectNodeTypes(item, types);
  }
  if (tree.zones) {
    for (const zoneContent of Object.values(tree.zones)) {
      for (const item of zoneContent) {
        collectNodeTypes(item, types);
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
 *
 * `builtinTypes` には **built-in primitive 型のみ** の集合を渡すこと (S-3)。
 * config 全 type (= 外部 component 込みの availableTypes) を渡すと外部 component が
 * dependencies[] から除外され不完全になる。呼出側は buildConfig の
 * `BUILTIN_PRIMITIVE_TYPE_NAMES` から作った集合を渡す。
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
  byType: Map<string, ExpandableComposite>,
  availableTypes: Set<string>,
): { content: Content; zones: Zones } {
  // subtree を Data 形に整形 → id 再生成 (props.id + zones キー itemId 同期、props 内 slot
  // ノードの id も regeneratePuckDataIds が props 再帰処理で再生成する)。
  const dataFragment: Data = {
    root: { props: {} },
    content: composite.tree.content,
    ...(composite.tree.zones ? { zones: composite.tree.zones } : {}),
  };
  const regenerated = regeneratePuckDataIds(dataFragment);

  // 1. まず本 subtree の直接ノードを guardNode で未ロード依存 error-card 化する
  //    (props 内 slot content も再帰 guard、#1415 P2-2)。複合部品 placeholder type 自体は
  //    config 登録済 (availableTypes 内) なので guard では落ちず、次段の展開に回る。
  const guardedContent = regenerated.content.map((item) =>
    guardNode(item, composite, availableTypes),
  );
  const guardedZones: Zones = {};
  if (regenerated.zones) {
    for (const [zoneKey, zoneContent] of Object.entries(regenerated.zones)) {
      guardedZones[zoneKey] = zoneContent.map((item) =>
        guardNode(item, composite, availableTypes),
      );
    }
  }

  // 2. subtree 自身が nested 複合部品 placeholder を内包する場合に備え、content / zones を
  //    expandContentArray で再帰展開する (slot props 内 placeholder もここで展開、#1415 P2-4)。
  //    nested 展開は各 nested composite 自身の expandOne→guardNode が依存解決するため、
  //    ここで再 guard はしない (outer errorType で二重ラップしないため)。
  const zones: Zones = {};
  const expandedContent = expandContentArray(guardedContent, byType, availableTypes);
  Object.assign(zones, expandedContent.zones);
  const content = expandedContent.content;
  for (const [zoneKey, zoneContent] of Object.entries(guardedZones)) {
    const expandedZone = expandContentArray(zoneContent, byType, availableTypes);
    Object.assign(zones, expandedZone.zones);
    zones[zoneKey] = expandedZone.content;
  }
  return { content, zones };
}

/**
 * subtree 内ノードの type が config に無ければ missing-dependency error-card 型に差し替える。
 * error-card 型 (= `makeErrorCardConfig` が config に登録するキー) は別途 mergeComposite 側で
 * 登録される前提。ここでは type / props を error-card 用に書き換えるのみ。
 *
 * #1415 P2-2: ノード自身の type が available な場合でも、props 内 slot content
 * (#1411 P-3、= Puck node 配列) を再帰的に guard する。slot 内に未ロード外部 component を
 * 含む複合部品が、その nested ノードを error-card 化せず素通りするのを防ぐ。
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
  // ノード自身は OK。props 内 slot content を再帰的に guard する。
  const slotEntries = slotContentEntries(item);
  if (slotEntries.length === 0) return item;
  const props = { ...(item as { props: Record<string, unknown> }).props };
  for (const [propName, children] of slotEntries) {
    props[propName] = children.map((child) =>
      guardNode(child, composite, availableTypes),
    );
  }
  return { ...item, props } as ComponentData;
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
 * 1 つの Content 配列内の複合部品 placeholder を展開し、展開後の配列と
 * merge すべき zones サブセットを返す内部ヘルパ。
 *
 * placeholder は該当 index に subtree (id 再生成済) を flat 挿入する。
 * placeholder でないノードはそのまま保持する。ただし非 placeholder ノードでも、その
 * **props 内 slot content** (#1411 P-3、= Puck node 配列) に placeholder が drop されている
 * 場合はその slot 配列も再帰的に展開し、展開後の配列を props に書き戻す (#1415 P2-4)。
 * slot 内展開で生まれる nested zones も呼出側に伝播するよう zones に集約する。
 */
function expandContentArray(
  content: Content,
  byType: Map<string, ExpandableComposite>,
  availableTypes: Set<string>,
): { content: Content; zones: Zones } {
  const newContent: Content = [];
  const zones: Zones = {};
  for (const item of content) {
    const type = (item as { type?: unknown }).type;
    const composite = typeof type === "string" ? byType.get(type) : undefined;
    if (composite) {
      // placeholder を subtree に展開 (その場 flat 挿入)。
      const expanded = expandOne(composite, byType, availableTypes);
      newContent.push(...expanded.content);
      Object.assign(zones, expanded.zones);
      continue;
    }
    // 非 placeholder ノード。props 内 slot content に placeholder があれば再帰展開する。
    newContent.push(expandNodeSlots(item, byType, availableTypes, zones));
  }
  return { content: newContent, zones };
}

/**
 * 1 ノードの props 内 slot content (#1411 P-3) 内の複合部品 placeholder を再帰展開する
 * (#1415 P2-4)。各 slot 配列を expandContentArray に通し、展開後の配列を props に書き戻した
 * ノードを返す。slot が無ければ参照透過に同一ノードを返す (冪等)。slot 展開で生まれる nested
 * zones は引数 zones (= 親が集約する Zones) に Object.assign する。
 */
function expandNodeSlots(
  item: ComponentData,
  byType: Map<string, ExpandableComposite>,
  availableTypes: Set<string>,
  zones: Zones,
): ComponentData {
  const slotEntries = slotContentEntries(item);
  if (slotEntries.length === 0) return item;
  const props = { ...(item as { props: Record<string, unknown> }).props };
  for (const [propName, children] of slotEntries) {
    const expanded = expandContentArray(children as Content, byType, availableTypes);
    props[propName] = expanded.content;
    Object.assign(zones, expanded.zones);
  }
  return { ...item, props } as ComponentData;
}

/**
 * data 内の複合部品 placeholder ノードを subtree に展開する純粋・冪等関数 (#1412 P-4)。
 *
 * - content 直下の placeholder ノードを検出 → 該当 index に subtree (id 再生成済) を展開。
 *   zones サブセットは data.zones に merge する。
 * - data.zones の各 zone content 配列内 (= Container/Row/Col/Card の DropZone に drop された
 *   placeholder) も同じロジックで展開する。zone key (`<itemId>:<zoneName>`) は保持し、中身の
 *   配列のみ書き換える。
 * - 展開した subtree が自身の zones サブセット (nested DropZone) を持つ場合、それらも
 *   data.zones に merge する。展開ノードの id は regeneratePuckDataIds で UUID 再生成済のため
 *   新規 zones キーは既存キーと衝突しない。
 * - 外部 component の slot props (`props.<slotName>` 配列、#1411 P-3) に drop された placeholder も
 *   再帰的に展開する (#1415 P2-4)。展開後の配列を props に書き戻し、slot 内 placeholder が生む
 *   nested zones も data.zones に merge する。slot 内 slot のさらなるネストも辿る。
 * - 依存 type が `availableTypes` に無い subtree 内ノードは error-card 型に差し替える (capability 6)。
 * - placeholder が content・zones・slot props いずれにも無ければ参照透過に同一構造を返す
 *   (冪等、controlled mode の onChange→展開→setData 無限ループ防止)。
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

  const isPlaceholder = (item: unknown): boolean => {
    const type = (item as { type?: unknown }).type;
    return typeof type === "string" && byType.has(type);
  };

  // ノード自身が placeholder か、または props 内 slot content (#1411 P-3) のいずれかの
  // 階層に placeholder を内包するか (再帰、slot 内 slot も考慮) を判定する (#1415 P2-4)。
  const nodeContainsPlaceholder = (item: ComponentData): boolean => {
    if (isPlaceholder(item)) return true;
    for (const [, children] of slotContentEntries(item)) {
      if (children.some(nodeContainsPlaceholder)) return true;
    }
    return false;
  };

  // content 直下・zones・slot props いずれかに placeholder があるか判定 (冪等性のため早期 return)。
  const dataZones: Zones = data.zones ?? {};
  const hasContentPlaceholder = data.content.some(nodeContainsPlaceholder);
  const hasZonePlaceholder = Object.values(dataZones).some((zc) =>
    zc.some(nodeContainsPlaceholder),
  );
  if (!hasContentPlaceholder && !hasZonePlaceholder) return data;

  // 既存 zones を起点に merge していく (展開で増える nested zones を Object.assign で追加)。
  const mergedZones: Zones = {};

  // content 直下の placeholder を展開。
  const expandedContent = expandContentArray(data.content, byType, availableTypes);
  const newContent = expandedContent.content;
  Object.assign(mergedZones, expandedContent.zones);

  // 既存 zones の各 zone content 配列内 placeholder を展開 (zone key は保持、中身のみ書換)。
  // 展開で増える nested zones は別キー (UUID) なので Object.assign の順序で既存を壊さない。
  for (const [zoneKey, zoneContent] of Object.entries(dataZones)) {
    const expandedZone = expandContentArray(zoneContent, byType, availableTypes);
    mergedZones[zoneKey] = expandedZone.content;
    Object.assign(mergedZones, expandedZone.zones);
  }

  return {
    ...data,
    content: newContent,
    ...(Object.keys(mergedZones).length > 0 ? { zones: mergedZones } : {}),
  };
}
