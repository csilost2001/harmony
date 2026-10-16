/**
 * 工程・項目・カラム・部品へ直接飛べる URL (UI 改善提案 第 5 弾 #95)。画面に依存しない純関数。
 * 形: `…/process-flow/edit/order-create#step=s3`。種類: step (工程)・item (画面項目)・column (カラム)・node (画面デザインの部品)・marker (マーカー)。
 * 開くと、その要素へスクロールして強調する。要素には `data-deeplink="step:s3"` のように印を付ける。
 */
export type DeepLinkKind = "step" | "item" | "column" | "node" | "marker";
export interface DeepLink { kind: DeepLinkKind; id: string }

const KINDS: readonly string[] = ["step", "item", "column", "node", "marker"];

export const DEEP_LINK_LABELS: Record<DeepLinkKind, string> = { step: "工程", item: "項目", column: "カラム", node: "部品", marker: "マーカー" };

/** `#step=s3` → { kind: "step", id: "s3" }。形が違えば null */
export function parseDeepLink(hash: string): DeepLink | null {
  const m = /^#?([a-z]+)=(.+)$/.exec(hash);
  if (!m || !KINDS.includes(m[1])) return null;
  try {
    const id = decodeURIComponent(m[2]);
    return id && id.length <= 200 ? { kind: m[1] as DeepLinkKind, id } : null;
  } catch { return null; }
}

/** リンクの末尾 (`#step=s3`) */
export function deepLinkHash(link: DeepLink): string {
  return `#${link.kind}=${encodeURIComponent(link.id)}`;
}

/** 要素の印の値 (`step:s3`) */
export const deepLinkKey = (link: DeepLink): string => `${link.kind}:${link.id}`;

/** 印の値 → リンク */
export function linkFromKey(key: string): DeepLink | null {
  const i = key.indexOf(":");
  if (i < 0) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  return KINDS.includes(kind) && id ? { kind: kind as DeepLinkKind, id } : null;
}

/** 開いているページの、その要素へのリンク (URL 全体) */
export function buildDeepLinkUrl(location: { origin: string; pathname: string; search?: string }, link: DeepLink): string {
  return `${location.origin}${location.pathname}${location.search ?? ""}${deepLinkHash(link)}`;
}

/** リンクの要素を探す (印 → 既存の印: カラムの行・部品の ID) */
export function findDeepLinkElement(root: ParentNode, link: DeepLink): HTMLElement | null {
  const esc = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));
  const sel = [`[data-deeplink="${esc(deepLinkKey(link))}"]`];
  if (link.kind === "column") sel.push(`[data-column-id="${esc(link.id)}"]`, `tr[data-row-id="${esc(link.id)}"]`);
  if (link.kind === "node") sel.push(`[data-node-id="${esc(link.id)}"]`);
  return root.querySelector<HTMLElement>(sel.join(","));
}
