/**
 * マーカー (人間 ↔ AI の指示・質問・メモ) の共通の処理。画面 (UI) と AI (MCP) の両方が、同じ関数で読み書きする。
 *
 * 保存の場所は schema どおり `<設計>.authoring.markers` (id は UUID、位置は `anchor`)。
 * 以前、MCP だけが処理フローの最上位の `markers` (平らな stepId / fieldPath、id は mk-…) を読み書きしていて、
 * 画面で付けたマーカーを AI が読めなかった。その古い形は、`migrateLegacyMarkers` で authoring.markers へ移す。
 *
 * 処理フロー以外の設計では、anchor.fieldPath に、設計の中の位置を書く (schema の既存の欄。形は `anchorPath*` 参照):
 *   テーブルのカラム `$.columns[<カラムの id>]` / 画面の項目 `$.items[<項目の id>]` / 画面の部品 `$.layout.nodes[<部品の id>]` ほか
 */

export type MarkerKind = "chat" | "attention" | "todo" | "question" | "validator";
export type MarkerAuthor = "human" | "ai";

export interface MarkerAnchorLike {
  stepId?: string;
  fieldPath?: string;
  shape?: unknown;
}

export interface MarkerLike {
  id: string;
  kind: MarkerKind;
  body: string;
  anchor?: MarkerAnchorLike;
  author: MarkerAuthor;
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
  validatorCode?: string;
  validatorPath?: string;
}

/** authoring を持つ設計 (処理フロー・画面・テーブルなど) */
export interface MarkerHost {
  authoring?: { markers?: MarkerLike[]; [k: string]: unknown };
  [k: string]: unknown;
}

/** マーカーを付けられる設計の種類 */
export const MARKER_ENTITY_TYPES = ["processFlow", "screen", "table", "view", "viewDefinition", "sequence", "pageLayout"] as const;
export type MarkerEntityType = (typeof MARKER_ENTITY_TYPES)[number];

export const MARKER_ENTITY_LABELS: Record<MarkerEntityType, string> = {
  processFlow: "処理フロー",
  screen: "画面",
  table: "テーブル",
  view: "ビュー",
  viewDefinition: "ビュー定義",
  sequence: "シーケンス",
  pageLayout: "ページレイアウト",
};

export const MARKER_KINDS: readonly MarkerKind[] = ["chat", "attention", "todo", "question", "validator"];
/** 人 / AI が付けられる種類 (validator はツールが出す警告なので、付けられない) */
export const MARKER_ADDABLE_KINDS: readonly MarkerKind[] = ["chat", "attention", "todo", "question"];

export const MARKER_KIND_LABELS: Record<MarkerKind, string> = {
  chat: "チャット",
  attention: "注意",
  todo: "TODO",
  question: "質問",
  validator: "検査の警告",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** UUID v4 を作る (crypto が使えない環境 = HTTP の非セキュア文脈でも動くように、乱数で組み立てる) */
export function newMarkerId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    try { return c.randomUUID(); } catch { /* 非セキュア文脈では使えない */ }
  }
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

/**
 * 古い id (mk-…) から、いつも同じ UUID を作る。移す処理は、読むたびにメモリ上でやり直すので、
 * 乱数の id にすると、「一覧で見た id」と「解決するときに読み直した id」が食い違ってしまう。
 */
export function stableMarkerId(oldId: string): string {
  if (UUID_RE.test(oldId)) return oldId;
  // cyrb128 (4 つの 32 ビットの混ぜ合わせ)
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < oldId.length; i++) {
    const k = oldId.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (parseInt(hex[16], 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const nowIso = () => new Date().toISOString();

function markersOf(doc: MarkerHost): MarkerLike[] {
  return Array.isArray(doc.authoring?.markers) ? doc.authoring!.markers! : [];
}

function setMarkers(doc: MarkerHost, list: MarkerLike[]): void {
  if (list.length > 0) doc.authoring = { ...(doc.authoring ?? {}), markers: list };
  else if (doc.authoring) {
    const { markers: _drop, ...rest } = doc.authoring;
    void _drop;
    if (Object.keys(rest).length > 0) doc.authoring = rest; else delete doc.authoring;
  }
}

/**
 * 古い形 (最上位の `markers`・平らな stepId / fieldPath・mk-… の id) を、schema の形 (authoring.markers・anchor・UUID) へ移す。
 * 移したマーカーの数を返す (0 なら何も変えていない)。
 */
export function migrateLegacyMarkers(doc: MarkerHost): number {
  const legacy = (doc as { markers?: unknown }).markers;
  if (!Array.isArray(legacy)) return 0;
  const moved: MarkerLike[] = [];
  for (const raw of legacy) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (typeof m.body !== "string" || typeof m.kind !== "string") continue;
    const anchor: MarkerAnchorLike = {};
    const flatStep = typeof m.stepId === "string" ? m.stepId : undefined;
    const flatPath = typeof m.fieldPath === "string" ? m.fieldPath : undefined;
    const given = m.anchor && typeof m.anchor === "object" ? (m.anchor as MarkerAnchorLike) : {};
    if (given.stepId ?? flatStep) anchor.stepId = given.stepId ?? flatStep;
    if (given.fieldPath ?? flatPath) anchor.fieldPath = given.fieldPath ?? flatPath;
    if (given.shape !== undefined) anchor.shape = given.shape;
    const next: MarkerLike = {
      id: typeof m.id === "string" && m.id ? stableMarkerId(m.id) : newMarkerId(),
      kind: (MARKER_KINDS as readonly string[]).includes(m.kind) ? (m.kind as MarkerKind) : "chat",
      body: m.body,
      author: m.author === "ai" ? "ai" : "human",
      createdAt: typeof m.createdAt === "string" ? m.createdAt : nowIso(),
    };
    if (Object.keys(anchor).length > 0) next.anchor = anchor;
    if (typeof m.resolvedAt === "string") next.resolvedAt = m.resolvedAt;
    if (typeof m.resolution === "string") next.resolution = m.resolution;
    moved.push(next);
  }
  delete (doc as { markers?: unknown }).markers;
  if (moved.length > 0) setMarkers(doc, [...markersOf(doc), ...moved]);
  return Math.max(moved.length, legacy.length > 0 ? 1 : 0);
}

export interface MarkerFilter {
  unresolvedOnly?: boolean;
  kind?: MarkerKind;
  stepId?: string;
  /** anchor.fieldPath が、この文字で始まるもの */
  fieldPathPrefix?: string;
}

export function listMarkers(doc: MarkerHost, filter: MarkerFilter = {}): MarkerLike[] {
  let list = markersOf(doc);
  if (filter.unresolvedOnly) list = list.filter((m) => !m.resolvedAt);
  if (filter.kind) list = list.filter((m) => m.kind === filter.kind);
  if (filter.stepId !== undefined) list = list.filter((m) => m.anchor?.stepId === filter.stepId);
  if (filter.fieldPathPrefix !== undefined) list = list.filter((m) => (m.anchor?.fieldPath ?? "").startsWith(filter.fieldPathPrefix!));
  return list;
}

export interface NewMarker {
  kind: MarkerKind;
  body: string;
  author: MarkerAuthor;
  stepId?: string;
  fieldPath?: string;
}

/** マーカーを足す (doc を書き換える)。足したマーカーを返す。 */
export function addMarker(doc: MarkerHost, input: NewMarker, newId: () => string = newMarkerId): MarkerLike {
  const anchor: MarkerAnchorLike = {};
  if (input.stepId) anchor.stepId = input.stepId;
  if (input.fieldPath) anchor.fieldPath = input.fieldPath;
  const next: MarkerLike = { id: newId(), kind: input.kind, body: input.body, author: input.author, createdAt: nowIso() };
  if (Object.keys(anchor).length > 0) next.anchor = anchor;
  setMarkers(doc, [...markersOf(doc), next]);
  return next;
}

export function resolveMarker(doc: MarkerHost, markerId: string, resolution?: string): void {
  const list = markersOf(doc);
  const i = list.findIndex((m) => m.id === markerId);
  if (i < 0) throw new Error(`marker ${markerId} が見つかりません`);
  const m = { ...list[i], resolvedAt: nowIso() };
  if (resolution !== undefined) m.resolution = resolution;
  setMarkers(doc, list.map((x, k) => (k === i ? m : x)));
}

export function unresolveMarker(doc: MarkerHost, markerId: string): void {
  const list = markersOf(doc);
  const i = list.findIndex((m) => m.id === markerId);
  if (i < 0) throw new Error(`marker ${markerId} が見つかりません`);
  const { resolvedAt: _a, resolution: _b, ...rest } = list[i];
  void _a; void _b;
  setMarkers(doc, list.map((x, k) => (k === i ? rest : x)));
}

export function removeMarker(doc: MarkerHost, markerId: string): void {
  const list = markersOf(doc);
  if (!list.some((m) => m.id === markerId)) throw new Error(`marker ${markerId} が見つかりません`);
  setMarkers(doc, list.filter((m) => m.id !== markerId));
}

export interface MarkerSummary {
  total: number;
  unresolved: number;
  byKind: Record<MarkerKind, number>;
}

/** 件数 (総数・未解決・未解決の種類別) */
export function summarizeMarkers(markers: readonly MarkerLike[]): MarkerSummary {
  const byKind: Record<MarkerKind, number> = { chat: 0, attention: 0, todo: 0, question: 0, validator: 0 };
  let unresolved = 0;
  for (const m of markers) {
    if (m.resolvedAt) continue;
    unresolved++;
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  }
  return { total: markers.length, unresolved, byKind };
}

// ─── anchor の位置 (処理フロー以外) ─────────────────────────────────

export const anchorPathColumn = (columnId: string) => `$.columns[${columnId}]`;
export const anchorPathItem = (itemId: string) => `$.items[${itemId}]`;
export const anchorPathLayoutNode = (nodeId: string) => `$.layout.nodes[${nodeId}]`;
export const anchorPathRegion = (name: string) => `$.regions[${name}]`;

/** anchor を、人に見せる短い言葉にする (例: 「工程 step-3」「カラム col-02」)。位置が無ければ「全体」。 */
export function anchorLabel(anchor: MarkerAnchorLike | undefined): string {
  if (!anchor) return "全体";
  if (anchor.stepId) return `工程 ${anchor.stepId}${anchor.fieldPath ? ` (${anchor.fieldPath})` : ""}`;
  const p = anchor.fieldPath;
  if (!p) return "全体";
  const m = p.match(/^\$\.(columns|items|regions)\[([^\]]+)\]$/);
  if (m) return `${{ columns: "カラム", items: "項目", regions: "region" }[m[1] as "columns" | "items" | "regions"]} ${m[2]}`;
  const n = p.match(/^\$\.layout\.nodes\[([^\]]+)\]$/);
  if (n) return `部品 ${n[1]}`;
  return p;
}

/** anchor が、指定のカラム / 項目 / 部品を指しているか */
export function anchorIs(anchor: MarkerAnchorLike | undefined, path: string): boolean {
  return anchor?.fieldPath === path;
}

// ─── AI に渡す文 ───────────────────────────────────────────────────

export interface MarkerForPrompt {
  entityType: MarkerEntityType;
  entityId: string;
  entityName?: string;
  marker: MarkerLike;
}

/**
 * 未解決のマーカーを、AI (Claude Code など) にそのまま貼り付けて頼める文にする。
 * AI はこの文から、対象の設計と id を取り、MCP の designer__list_markers で本体を読む。
 */
export function buildAiPrompt(items: readonly MarkerForPrompt[]): string {
  const open = items.filter((i) => !i.marker.resolvedAt && i.marker.kind !== "validator");
  if (open.length === 0) return "";
  const lines = open.map((i, k) => {
    const where = `${MARKER_ENTITY_LABELS[i.entityType]} ${i.entityName ? `「${i.entityName}」` : ""}(${i.entityId}) の ${anchorLabel(i.marker.anchor)}`;
    return `${k + 1}. [${MARKER_KIND_LABELS[i.marker.kind]}] ${where}\n   ${i.marker.body.replace(/\n/g, "\n   ")}`;
  });
  return [
    `Harmony の設計に、人が付けたマーカー (指示・質問) が ${open.length} 件あります。/designer-work の手順で、順に対応してください。`,
    "対応したら、designer__resolve_marker で、何をしたか (または回答) を resolution に書いて解決してください。",
    "",
    ...lines,
  ].join("\n");
}
