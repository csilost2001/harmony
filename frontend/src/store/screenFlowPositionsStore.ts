/**
 * screenFlowPositionsStore.ts (v3 Phase 3-β、#561)
 * 画面フロー UI 座標の永続化ストア。
 *
 * - `<dataDir>/screen-flow-positions.json` (単一ファイル、v3 schema 準拠)
 * - $schema 属性で v3 schema 参照を保存
 * - view-mode preview cache: `v3-screen-flow-positions-preview` (positions のみ)
 *
 * 業務情報 (Screen entity / ScreenTransitionEntry / ScreenGroupEntry) は
 * harmony.json + <dataDir>/screens/<id>.json で管理する。本 store は UI 座標のみ。
 */
import type { Position, ScreenFlowPositions, Timestamp, TransitionLayout } from "../types/v3";

export interface ScreenFlowPositionsStorageBackend {
  loadScreenFlowPositions(): Promise<unknown>;
  saveScreenFlowPositions(data: unknown): Promise<void>;
}

let _backend: ScreenFlowPositionsStorageBackend | null = null;

export function setScreenFlowPositionsStorageBackend(b: ScreenFlowPositionsStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): ScreenFlowPositionsStorageBackend {
  if (!_backend) {
    throw new Error("画面フローレイアウトの保存には backend 接続が必要です。backend (port 5179) を起動してください。");
  }
  return _backend;
}

const SCREEN_FLOW_POSITIONS_PREVIEW_KEY = "v3-screen-flow-positions-preview";
const SCREEN_FLOW_POSITIONS_SCHEMA_REF = "../schemas/v3/screen-flow-positions.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

function createEmptyLayout(): ScreenFlowPositions {
  return {
    $schema: SCREEN_FLOW_POSITIONS_SCHEMA_REF,
    positions: {},
    transitions: {},
    updatedAt: nowTs(),
  };
}

export async function loadScreenFlowPositions(): Promise<ScreenFlowPositions> {
  const data = await requireBackend().loadScreenFlowPositions();
  const canonical = data ? data as ScreenFlowPositions : createEmptyLayout();
  const preview = loadScreenFlowPositionsPreview();
  if (!preview) return canonical;
  return {
    ...canonical,
    positions: { ...canonical.positions, ...preview.positions },
  };
}

export function loadScreenFlowPositionsPreview(): Pick<ScreenFlowPositions, "positions"> | null {
  const raw = localStorage.getItem(SCREEN_FLOW_POSITIONS_PREVIEW_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ScreenFlowPositions>;
    return { positions: parsed.positions ?? {} };
  } catch {
    return null;
  }
}

export function saveScreenFlowPositionsPreview(layout: Pick<ScreenFlowPositions, "positions">): void {
  try {
    localStorage.setItem(SCREEN_FLOW_POSITIONS_PREVIEW_KEY, JSON.stringify({ positions: layout.positions ?? {} }));
  } catch { /* ignore */ }
}

export function clearScreenFlowPositionsPreview(): void {
  try {
    localStorage.removeItem(SCREEN_FLOW_POSITIONS_PREVIEW_KEY);
  } catch { /* ignore */ }
}

export async function loadScreenFlowPositionsCanonical(): Promise<ScreenFlowPositions> {
  const data = await requireBackend().loadScreenFlowPositions();
  if (data) return data as ScreenFlowPositions;
  return createEmptyLayout();
}

export async function saveScreenFlowPositionsCanonical(layout: ScreenFlowPositions): Promise<void> {
  const toSave: ScreenFlowPositions = {
    ...layout,
    $schema: SCREEN_FLOW_POSITIONS_SCHEMA_REF,
    updatedAt: nowTs(),
  };
  await requireBackend().saveScreenFlowPositions(toSave);
  clearScreenFlowPositionsPreview();
}

export async function saveScreenFlowPositions(layout: ScreenFlowPositions): Promise<void> {
  await saveScreenFlowPositionsCanonical(layout);
}

/** entity ID (screen/group) の Position を取得 (未登録なら undefined)。 */
export function getPosition(layout: ScreenFlowPositions, id: string): Position | undefined {
  return layout.positions[id];
}

/** entity ID の Position を上書き。 */
export function setPosition(layout: ScreenFlowPositions, id: string, pos: Position): ScreenFlowPositions {
  return {
    ...layout,
    positions: { ...layout.positions, [id]: pos },
  };
}

/** entity ID の Position を削除 (画面/グループ削除時)。 */
export function removePosition(layout: ScreenFlowPositions, id: string): ScreenFlowPositions {
  if (!(id in layout.positions)) return layout;
  const next = { ...layout.positions };
  delete next[id];
  return { ...layout, positions: next };
}

/** transition ID の TransitionLayout を上書き。 */
export function setTransitionLayout(
  layout: ScreenFlowPositions,
  id: string,
  tl: TransitionLayout,
): ScreenFlowPositions {
  return {
    ...layout,
    transitions: { ...(layout.transitions ?? {}), [id]: tl },
  };
}

/** transition ID の TransitionLayout を削除。 */
export function removeTransitionLayout(layout: ScreenFlowPositions, id: string): ScreenFlowPositions {
  if (!layout.transitions || !(id in layout.transitions)) return layout;
  const next = { ...layout.transitions };
  delete next[id];
  return { ...layout, transitions: next };
}
