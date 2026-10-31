/**
 * 画面フロー (画面・遷移・フロー図の位置) の、ファイルへの直接の書き込み (#1591)。
 *
 * 画面を足す・直す・消す・遷移をつなぐ MCP tool は、ブラウザが開いていればブラウザ (画面フローの store) に任せる。
 * ブラウザが無いときは、この module が、ブラウザと同じ結果になるようにファイルへ書く:
 * - harmony.json の `entities.screens[]` / `entities.screenTransitions[]` (一覧の索引。並び順 no は 1..N に振り直す)
 * - `screens/<id>.json` (画面の実体。見出しだけの業務部品レイアウトつき)
 * - `screen-flow-positions.json` (フロー図の位置。自動配置は既存の画面・グループと重ならない所)
 *
 * 書く前に、新しく増えるスキーマ違反が無いかを検査する (assertHarmonyStillValid。テーブルの tool と同じ)。
 * 書く順は、画面の実体 → 位置 → harmony.json (索引は最後。途中で止まっても索引に載らない実体が残るだけで、読み出しは一覧に補う)。
 */
import { randomUUID } from "node:crypto";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import {
  readProject, writeProject, readScreenEntity, writeScreenEntity, deleteScreen as deleteScreenFile,
  readScreenFlowPositions, writeScreenFlowPositions, listExistingEntityIds,
} from "./projectStorage.js";
import { harmonyFile, resolveDataRoot, screenFlowPositionsFile, withFileLock } from "./storageCore.js";
import { assertHarmonyStillValid } from "./handlers/table.js";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** 画面フロー図のノードの既定の大きさ・並べ方 (frontend の DEFAULT_NODE_SIZE / defaultPositionFor に合わせる) */
const NODE_W = 200;
const NODE_H = 100;
const GRID_X0 = 100;
const GRID_Y0 = 150;
const GRID_STEP_X = 250;
const GRID_STEP_Y = 180;
const GRID_COLUMNS = 8;
/** グループ (位置が無いときの既定の大きさ) */
const GROUP_W = 360;
const GROUP_H = 280;
/** ノードどうしの最低の隙間 */
const GAP = 20;
const POSITIONS_SCHEMA_REF = "../schemas/v3/screen-flow-positions.v3.schema.json";
const SCREEN_WHERE = "entities.screens / entities.screenTransitions";
const SCREEN_HINT = "kind は画面種別、purpose は page / gadget、trigger は click / submit / select / cancel / auto / back / other のいずれかにしてください";

/** 画面種別: 標準の種別、または拡張の `名前空間:種別` */
export const SCREEN_KINDS = ["login", "dashboard", "list", "detail", "form", "search", "confirm", "complete", "error", "modal", "wizard", "other"] as const;
/** schemas/v3/screen.v3.schema.json の ScreenKind (拡張参照) と同じ */
const EXTENSION_KIND_RE = /^[a-z][a-z0-9_-]*:[a-z][a-zA-Z0-9]*$/;
export function isValidScreenKind(v: unknown): v is string {
  return typeof v === "string" && ((SCREEN_KINDS as readonly string[]).includes(v) || EXTENSION_KIND_RE.test(v));
}
/** 画面種別の検査 (画面の追加・更新で、ブラウザの有無によらず使う) */
export function assertScreenKind(v: unknown): void {
  if (v !== undefined && !isValidScreenKind(v)) {
    throw new McpError(ErrorCode.InvalidParams, `type は ${SCREEN_KINDS.join(" / ")} のいずれか (または 名前空間:種別。例: retail:storeFront) にしてください: ${JSON.stringify(v)}`);
  }
}

/**
 * 同じワークスペースの harmony.json を読んで書く操作は、1 本ずつ行う。
 * MCP の呼び出しは並列に来るので、直列にしないと、読んだ時点の索引へ書き戻して、先の更新を黙って消す (#1591)。
 */
const locked = <T>(root: string, run: () => Promise<T>): Promise<T> => withFileLock(harmonyFile(root), run);

/** その ID の画面がすでにあれば断る (一覧の索引と、索引に無い実体のファイルの両方を見る)。ブラウザの有無によらず使う */
export async function assertScreenIdFree(root: string, id: string): Promise<void> {
  const project = await readProject(root);
  const entities = isRecord(project) && isRecord(project.entities) ? project.entities : {};
  const inIndex = arrayOf(entities, "screens").some((s) => s.id === id);
  if (inIndex || (await listExistingEntityIds("screen", root)).includes(id)) {
    throw new McpError(ErrorCode.InvalidParams, `画面 ID「${id}」はすでにあります。別の id にするか、省略して自動で決めてください`);
  }
}

/** 画面があるか (索引か実体のファイル) */
export async function screenExists(root: string, id: string): Promise<boolean> {
  const project = await readProject(root);
  const entities = isRecord(project) && isRecord(project.entities) ? project.entities : {};
  return arrayOf(entities, "screens").some((s) => s.id === id) || (await listExistingEntityIds("screen", root)).includes(id);
}

async function readProjectForWrite(root: string): Promise<Rec> {
  const project = await readProject(root);
  if (!isRecord(project)) {
    throw new McpError(ErrorCode.InvalidRequest, "harmony.json が見つかりません。ワークスペースを開いてからやり直してください (designer__workspace_open)");
  }
  return project;
}

function entitiesOf(project: Rec): Rec {
  if (!isRecord(project.entities)) project.entities = {};
  return project.entities as Rec;
}
const arrayOf = (e: Rec, key: string): Rec[] => (Array.isArray(e[key]) ? (e[key] as unknown[]).filter(isRecord) : []);
const renumber = (items: Rec[]): Rec[] => items.map((it, i) => ({ ...it, no: i + 1 }));

async function commitProject(project: Rec, next: Rec, root: string, now: string): Promise<void> {
  if (isRecord(next.meta)) next.meta.updatedAt = now;
  await assertHarmonyStillValid(project, next, SCREEN_WHERE, SCREEN_HINT);
  await writeProject(next, root);
}

interface Rect { x: number; y: number; w: number; h: number }

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/** フロー図で、いま場所を占めているもの (位置が無い画面は、frontend が置く既定の位置) */
function occupiedRects(entities: Rec, positions: Rec): Rect[] {
  const rects: Rect[] = [];
  const rectOf = (pos: unknown, fallback: Rect): Rect => {
    if (!isRecord(pos) || typeof pos.x !== "number" || typeof pos.y !== "number") return fallback;
    return {
      x: pos.x, y: pos.y,
      w: typeof pos.width === "number" ? pos.width : fallback.w,
      h: typeof pos.height === "number" ? pos.height : fallback.h,
    };
  };
  arrayOf(entities, "screens").forEach((s, i) => {
    rects.push(rectOf(positions[String(s.id)], { x: GRID_X0 + i * GRID_STEP_X, y: GRID_Y0, w: NODE_W, h: NODE_H }));
  });
  for (const g of arrayOf(entities, "screenGroups")) {
    rects.push(rectOf(positions[String(g.id)], { x: 0, y: 0, w: GROUP_W, h: GROUP_H }));
  }
  return rects;
}

/** 自動配置: 左上から格子 (横 8 列) を順に見て、既存の画面・グループと重ならない最初の所 */
export function findFreePosition(occupied: Rect[]): { x: number; y: number } {
  for (let row = 0; row < 10_000; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const x = GRID_X0 + col * GRID_STEP_X;
      const y = GRID_Y0 + row * GRID_STEP_Y;
      const cand: Rect = { x, y, w: NODE_W, h: NODE_H };
      if (!occupied.some((r) => overlaps(cand, r))) return { x, y };
    }
  }
  return { x: GRID_X0, y: GRID_Y0 };
}

async function readPositions(root: string): Promise<Rec> {
  const raw = await readScreenFlowPositions(root);
  return isRecord(raw)
    ? { ...raw, positions: isRecord(raw.positions) ? raw.positions : {} }
    : { $schema: POSITIONS_SCHEMA_REF, positions: {}, transitions: {} };
}

export interface AddScreenFileInput {
  /** 省略時は `scr-<8桁>` を採番 */
  id?: string;
  name: string;
  kind?: string;
  path?: string;
  position?: { x: number; y: number };
  purpose: "page" | "gadget";
}

/** ブラウザ無しで画面を足す。画面の実体・フロー図の位置・一覧の索引を書く */
export async function addScreenToFiles(root: string, input: AddScreenFileInput): Promise<{ screenId: string; position: { x: number; y: number } }> {
  return locked(root, async () => {
    const project = await readProjectForWrite(root);
    const next = structuredClone(project);
    const entities = entitiesOf(next);
    const screens = arrayOf(entities, "screens");

    // 重複 ID は断る (索引に無い実体のファイルも見る)
    const taken = new Set<string>([...screens.map((s) => String(s.id)), ...await listExistingEntityIds("screen", root)]);
    let id = input.id;
    if (id) await assertScreenIdFree(root, id);
    else do { id = `scr-${randomUUID().slice(0, 8)}`; } while (taken.has(id));

    const now = new Date().toISOString();
    const kind = input.kind ?? "other";
    const screenPath = input.path ?? "";
    const prevPositions = await readScreenFlowPositions(root); // 失敗したときに戻す
    const positionsDoc = await readPositions(root);
    const positions = positionsDoc.positions as Rec;
    const position = input.position ?? findFreePosition(occupiedRects(entities, positions));

    screens.push({ id, no: screens.length + 1, name: input.name, kind, purpose: input.purpose, path: screenPath, hasDesign: false, updatedAt: now });
    entities.screens = renumber(screens);
    // 先に検査する (何も書かずに断るため)
    if (isRecord(next.meta)) next.meta.updatedAt = now;
    await assertHarmonyStillValid(project, next, SCREEN_WHERE, SCREEN_HINT);

    // 画面の実体: 画面名の見出しだけを置いた業務部品レイアウト (ブラウザの buildDefaultScreen と同じ)
    await writeScreenEntity(id, {
      id, uuid: randomUUID(), name: input.name, createdAt: now, updatedAt: now, kind, path: screenPath, items: [],
      layout: { version: 1, nodes: [{ id: "pageTitle", type: "heading", props: { text: input.name, level: 1 } }] },
    }, root);
    try {
      positions[id] = { x: position.x, y: position.y, width: NODE_W, height: NODE_H };
      await writeScreenFlowPositions({ ...positionsDoc, positions, updatedAt: now }, root);
      await writeProject(next, root);
    } catch (e) {
      // 失敗した所より前に書いたもの (実体・位置) を、全て戻す
      await deleteScreenFile(id, root).catch(() => undefined);
      if (prevPositions === null) await fs.rm(screenFlowPositionsFile(await resolveDataRoot(root)), { force: true }).catch(() => undefined);
      else await writeScreenFlowPositions(prevPositions, root).catch(() => undefined);
      throw e;
    }
    return { screenId: id, position };
  });
}

export interface UpdateScreenFilePatch {
  name?: string;
  kind?: string;
  description?: string;
  path?: string;
  purpose?: string;
  /** null = 解除 */
  pageLayoutId?: string | null;
}

/** ブラウザ無しで画面のメタを直す。索引と画面の実体の両方を揃える */
export async function updateScreenInFiles(root: string, screenId: string, patch: UpdateScreenFilePatch): Promise<void> {
  return locked(root, async () => {
    const project = await readProjectForWrite(root);
    const next = structuredClone(project);
    const screens = arrayOf(entitiesOf(next), "screens");
    const entry = screens.find((s) => s.id === screenId);
    if (!entry) throw new McpError(ErrorCode.InvalidParams, `画面が見つかりません: ${screenId}`);
    const now = new Date().toISOString();

    if (patch.name !== undefined) entry.name = patch.name;
    if (patch.kind !== undefined) entry.kind = patch.kind;
    if (patch.path !== undefined) entry.path = patch.path;
    if (patch.purpose !== undefined) entry.purpose = patch.purpose;
    if (patch.pageLayoutId === null) delete entry.pageLayoutId;
    else if (patch.pageLayoutId !== undefined) entry.pageLayoutId = patch.pageLayoutId;
    entry.updatedAt = now;
    entitiesOf(next).screens = screens;
    if (isRecord(next.meta)) next.meta.updatedAt = now;
    await assertHarmonyStillValid(project, next, SCREEN_WHERE, SCREEN_HINT);

    const entity = await readScreenEntity(screenId, root);
    if (isRecord(entity)) {
      const e: Rec = { ...entity };
      if (patch.name !== undefined) e.name = patch.name;
      if (patch.kind !== undefined) e.kind = patch.kind;
      if (patch.path !== undefined) e.path = patch.path;
      if (patch.description !== undefined) e.description = patch.description;
      await writeScreenEntity(screenId, e, root);
    }
    await writeProject(next, root);
  });
}

/** ブラウザ無しで画面を消す。つながる遷移・画面の実体・フロー図の位置も消す */
export async function removeScreenFromFiles(root: string, screenId: string): Promise<void> {
  return locked(root, async () => {
    const project = await readProjectForWrite(root);
    const next = structuredClone(project);
    const entities = entitiesOf(next);
    const screens = arrayOf(entities, "screens");
    if (!screens.some((s) => s.id === screenId)) throw new McpError(ErrorCode.InvalidParams, `画面が見つかりません: ${screenId}`);
    const now = new Date().toISOString();
    entities.screens = renumber(screens.filter((s) => s.id !== screenId));
    const transitions = arrayOf(entities, "screenTransitions");
    const removedEdgeIds = transitions.filter((e) => e.sourceScreenId === screenId || e.targetScreenId === screenId).map((e) => String(e.id));
    if (Array.isArray(entities.screenTransitions)) {
      entities.screenTransitions = transitions.filter((e) => e.sourceScreenId !== screenId && e.targetScreenId !== screenId);
    }
    if (isRecord(next.meta)) next.meta.updatedAt = now;
    await assertHarmonyStillValid(project, next, SCREEN_WHERE, SCREEN_HINT);

    await writeProject(next, root); // 索引から先に外す
    await deleteScreenFile(screenId, root);
    const raw = await readScreenFlowPositions(root);
    if (isRecord(raw)) {
      const positions = isRecord(raw.positions) ? { ...raw.positions } : {};
      const trans = isRecord(raw.transitions) ? { ...raw.transitions } : {};
      const hadPos = screenId in positions;
      delete positions[screenId];
      let hadTrans = false;
      for (const id of removedEdgeIds) if (id in trans) { delete trans[id]; hadTrans = true; }
      if (hadPos || hadTrans) await writeScreenFlowPositions({ ...raw, positions, transitions: trans, updatedAt: now }, root);
    }
  });
}

/** ブラウザ無しで画面の遷移を足す。id は `tr-NN` の連番 (ブラウザと同じ) */
export async function addEdgeToFiles(root: string, input: { source: string; target: string; label: string; trigger?: string }): Promise<{ edgeId: string }> {
  return locked(root, async () => {
    const project = await readProjectForWrite(root);
    const next = structuredClone(project);
    const entities = entitiesOf(next);
    const screenIds = new Set(arrayOf(entities, "screens").map((s) => String(s.id)));
    for (const [label, id] of [["source", input.source], ["target", input.target]] as const) {
      if (!screenIds.has(id)) throw new McpError(ErrorCode.InvalidParams, `${label} の画面が見つかりません: ${id} (designer__list_screens で確かめてください)`);
    }
    const transitions = arrayOf(entities, "screenTransitions");
    const used = new Set(transitions.map((e) => String(e.id)));
    let n = 1;
    while (used.has(`tr-${String(n).padStart(2, "0")}`)) n++;
    const edgeId = `tr-${String(n).padStart(2, "0")}`;
    transitions.push({
      id: edgeId, sourceScreenId: input.source, targetScreenId: input.target,
      ...(input.label ? { label: input.label } : {}), trigger: input.trigger ?? "click",
    });
    entities.screenTransitions = transitions;
    await commitProject(project, next, root, new Date().toISOString());
    return { edgeId };
  });
}

/** ブラウザ無しで画面の遷移を消す */
export async function removeEdgeFromFiles(root: string, edgeId: string): Promise<void> {
  return locked(root, async () => {
    const project = await readProjectForWrite(root);
    const next = structuredClone(project);
    const entities = entitiesOf(next);
    const transitions = arrayOf(entities, "screenTransitions");
    if (!transitions.some((e) => e.id === edgeId)) throw new McpError(ErrorCode.InvalidParams, `エッジが見つかりません: ${edgeId}`);
    entities.screenTransitions = transitions.filter((e) => e.id !== edgeId);
    const now = new Date().toISOString();
    await commitProject(project, next, root, now);
    const raw = await readScreenFlowPositions(root);
    if (isRecord(raw) && isRecord(raw.transitions) && edgeId in raw.transitions) {
      const trans = { ...raw.transitions };
      delete trans[edgeId];
      await writeScreenFlowPositions({ ...raw, transitions: trans, updatedAt: now }, root);
    }
  });
}

export interface FlowSnapshot {
  name: string;
  screens: Array<{ id: string; name: string; type: string; path: string; hasDesign: boolean }>;
  edges: Array<{ id: string; source: string; target: string; label: string; trigger: string }>;
}

/** harmony.json (v3) から画面フローの要約を作る (ブラウザ不要の読み出し) */
export function flowSnapshotOf(project: unknown): FlowSnapshot | null {
  if (!isRecord(project)) return null;
  const entities = isRecord(project.entities) ? project.entities : {};
  return {
    name: isRecord(project.meta) && typeof project.meta.name === "string" ? project.meta.name : "",
    screens: arrayOf(entities, "screens").map((s) => ({
      id: String(s.id), name: String(s.name ?? ""), type: typeof s.kind === "string" ? s.kind : "other",
      path: typeof s.path === "string" ? s.path : "", hasDesign: s.hasDesign === true,
    })),
    edges: arrayOf(entities, "screenTransitions").map((e) => ({
      id: String(e.id), source: String(e.sourceScreenId), target: String(e.targetScreenId),
      label: typeof e.label === "string" ? e.label : "", trigger: typeof e.trigger === "string" ? e.trigger : "click",
    })),
  };
}
