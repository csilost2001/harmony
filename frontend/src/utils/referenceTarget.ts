/**
 * 入力欄の中の `@screen.cart` / `@table.orders.field.id` / `@conv.msg.required` のような参照から、
 * 「定義」の画面への経路を求める (Ctrl+クリック / F12 の定義へ移動)。
 */
export interface ReferenceTarget {
  /** 参照の文字 (例: `@screen.cart.item.qty`) */
  text: string;
  prefix: string;
  /** ワークスペース内の経路 (例: `/screen/items/cart`) */
  route: string;
  /** 利用者に見せる説明 (例: 「画面 cart」) */
  label: string;
}

const ENTITY_ROUTES: Record<string, { label: string; route: (id: string) => string }> = {
  screen: { label: "画面", route: (id) => `/screen/items/${id}` },
  table: { label: "テーブル", route: (id) => `/table/edit/${id}` },
  view: { label: "ビュー", route: (id) => `/view/edit/${id}` },
  viewer: { label: "ビュー定義", route: (id) => `/view-definition/edit/${id}` },
  seq: { label: "シーケンス", route: (id) => `/sequence/edit/${id}` },
  layout: { label: "ページレイアウト", route: (id) => `/page-layout/edit/${id}` },
  flow: { label: "処理フロー", route: (id) => `/process-flow/edit/${id}` },
};

/** 汎用定義の接頭辞 → 種類 (/generic-definition/<kind>/<name>) */
const GENERIC_KINDS: Record<string, { label: string; kind: string }> = {
  contract: { label: "データ契約", kind: "data-contract" },
  type: { label: "ドメイン型", kind: "domain-type" },
  exception: { label: "例外型", kind: "exception-type" },
  rule: { label: "業務ルール", kind: "application-rule" },
  validation: { label: "検証ルール", kind: "validation-rule" },
  behavior: { label: "UI の振る舞い", kind: "ui-behavior" },
  policy: { label: "実行ポリシー", kind: "runtime-policy" },
  component: { label: "部品", kind: "component-definition" },
  const: { label: "定数", kind: "constants" },
  msg: { label: "メッセージ", kind: "message" },
  event: { label: "ドメインイベント", kind: "domain-event" },
  logEvent: { label: "ログイベント", kind: "log-event" },
  logConfig: { label: "ログ設定", kind: "log-config" },
};

const TOKEN = /@([A-Za-z]+)(?:\.([A-Za-z0-9_-]+))?(?:\.[A-Za-z0-9_.-]*)?/g;

/** 文字列の pos (カーソル位置) にある参照から、定義の画面への経路を求める。参照の上でなければ null。 */
export function referenceAt(text: string, pos: number): ReferenceTarget | null {
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (pos < start || pos > end) continue;
    const trimmed = m[0].replace(/\.$/, "");
    const prefix = m[1];
    const first = m[2];
    if (prefix === "conv") return { text: trimmed, prefix, route: "/conventions/catalog", label: "規約カタログ" };
    if (!first) return null;
    const entity = ENTITY_ROUTES[prefix];
    if (entity) return { text: trimmed, prefix, route: entity.route(first), label: `${entity.label} ${first}` };
    const generic = GENERIC_KINDS[prefix];
    if (generic) return { text: trimmed, prefix, route: `/generic-definition/${generic.kind}/${first}`, label: `${generic.label} ${first}` };
    return null;
  }
  return null;
}

const EVENT = "harmony:go-to-reference";

/** 定義の画面を開く合図 (CommonHeader の ReferenceNavigator が受けて移動する) */
export function requestGoToReference(target: ReferenceTarget): void {
  window.dispatchEvent(new CustomEvent<ReferenceTarget>(EVENT, { detail: target }));
}

export function onGoToReference(handler: (target: ReferenceTarget) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ReferenceTarget>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
