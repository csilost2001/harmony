/**
 * screenLayoutStore.ts (v3 Phase 3-β、#561)
 * 画面フロー UI 座標の永続化ストア。
 *
 * - `data/screen-layout.json` (単一ファイル、v3 schema 準拠)
 * - $schema 属性で v3 schema 参照を保存
 * - localStorage キー prefix: `v3-screen-layout`
 *
 * 業務情報 (Screen entity / ScreenTransitionEntry / ScreenGroupEntry) は
 * project.json + data/screens/<id>.json で管理する。本 store は UI 座標のみ。
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

const SCREEN_LAYOUT_KEY = "v3-screen-layout";
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
  if (_backend) {
    const data = await _backend.loadScreenLayout();
    if (data) return data as ScreenLayout;
    return createEmptyLayout();
  }
  const raw = localStorage.getItem(SCREEN_LAYOUT_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as ScreenLayout;
    } catch { /* ignore */ }
  }
  return createEmptyLayout();
}

export async function saveScreenLayout(layout: ScreenLayout): Promise<void> {
  const toSave: ScreenLayout = {
    ...layout,
    $schema: SCREEN_LAYOUT_SCHEMA_REF,
    updatedAt: nowTs(),
  };
  if (_backend) {
    await _backend.saveScreenLayout(toSave);
    return;
  }
  localStorage.setItem(SCREEN_LAYOUT_KEY, JSON.stringify(toSave));
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
