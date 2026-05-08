/**
 * screenLayoutStore.ts (v3 Phase 3-β、#561)
 * 画面フロー UI 座標の永続化ストア。
 *
 * - `data/screen-layout.json` (単一ファイル、v3 schema 準拠)
 * - $schema 属性で v3 schema 参照を保存
 * - view-mode preview cache: `v3-screen-layout-preview` (positions のみ)
 *
 * 業務情報 (Screen entity / ScreenTransitionEntry / ScreenGroupEntry) は
 * harmony.json + <dataDir>/screens/<id>.json で管理する。本 store は UI 座標のみ。
 */
import type { Position, ScreenLayout, Timestamp, TransitionLayout } from "../types/v3";

export interface ScreenLayoutStorageBackend {
  loadScreenLayout(): Promise<unknown>;
  saveScreenLayout(data: unknown): Promise<void>;
}

let _backend: ScreenLayoutStorageBackend | null = null;

export function setScreenLayoutStorageBackend(b: ScreenLayoutStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): ScreenLayoutStorageBackend {
  if (!_backend) {
    throw new Error("画面フローレイアウトの保存には backend 接続が必要です。backend (port 5179) を起動してください。");
  }
  return _backend;
}

const SCREEN_LAYOUT_PREVIEW_KEY = "v3-screen-layout-preview";
const SCREEN_LAYOUT_SCHEMA_REF = "../schemas/v3/screen-layout.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

function createEmptyLayout(): ScreenLayout {
  return {
    $schema: SCREEN_LAYOUT_SCHEMA_REF,
    positions: {},
    transitions: {},
    updatedAt: nowTs(),
  };
}

export async function loadScreenLayout(): Promise<ScreenLayout> {
  const data = await requireBackend().loadScreenLayout();
  const canonical = data ? data as ScreenLayout : createEmptyLayout();
  const preview = loadScreenLayoutPreview();
  if (!preview) return canonical;
  return {
    ...canonical,
    positions: { ...canonical.positions, ...preview.positions },
  };
}

export function loadScreenLayoutPreview(): Pick<ScreenLayout, "positions"> | null {
  const raw = localStorage.getItem(SCREEN_LAYOUT_PREVIEW_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ScreenLayout>;
    return { positions: parsed.positions ?? {} };
  } catch {
    return null;
  }
}

export function saveScreenLayoutPreview(layout: Pick<ScreenLayout, "positions">): void {
  try {
    localStorage.setItem(SCREEN_LAYOUT_PREVIEW_KEY, JSON.stringify({ positions: layout.positions ?? {} }));
  } catch { /* ignore */ }
}

export function clearScreenLayoutPreview(): void {
  try {
    localStorage.removeItem(SCREEN_LAYOUT_PREVIEW_KEY);
  } catch { /* ignore */ }
}

export async function loadScreenLayoutCanonical(): Promise<ScreenLayout> {
  const data = await requireBackend().loadScreenLayout();
  if (data) return data as ScreenLayout;
  return createEmptyLayout();
}

export async function saveScreenLayoutCanonical(layout: ScreenLayout): Promise<void> {
  const toSave: ScreenLayout = {
    ...layout,
    $schema: SCREEN_LAYOUT_SCHEMA_REF,
    updatedAt: nowTs(),
  };
  await requireBackend().saveScreenLayout(toSave);
  clearScreenLayoutPreview();
}

export async function saveScreenLayout(layout: ScreenLayout): Promise<void> {
  await saveScreenLayoutCanonical(layout);
}

/** entity ID (screen/group) の Position を取得 (未登録なら undefined)。 */
export function getPosition(layout: ScreenLayout, id: string): Position | undefined {
  return layout.positions[id];
}

/** entity ID の Position を上書き。 */
export function setPosition(layout: ScreenLayout, id: string, pos: Position): ScreenLayout {
  return {
    ...layout,
    positions: { ...layout.positions, [id]: pos },
  };
}

/** entity ID の Position を削除 (画面/グループ削除時)。 */
export function removePosition(layout: ScreenLayout, id: string): ScreenLayout {
  if (!(id in layout.positions)) return layout;
  const next = { ...layout.positions };
  delete next[id];
  return { ...layout, positions: next };
}

/** transition ID の TransitionLayout を上書き。 */
export function setTransitionLayout(
  layout: ScreenLayout,
  id: string,
  tl: TransitionLayout,
): ScreenLayout {
  return {
    ...layout,
    transitions: { ...(layout.transitions ?? {}), [id]: tl },
  };
}

/** transition ID の TransitionLayout を削除。 */
export function removeTransitionLayout(layout: ScreenLayout, id: string): ScreenLayout {
  if (!layout.transitions || !(id in layout.transitions)) return layout;
  const next = { ...layout.transitions };
  delete next[id];
  return { ...layout, transitions: next };
}
