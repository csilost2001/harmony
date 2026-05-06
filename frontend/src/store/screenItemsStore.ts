import type { ScreenItem, ScreenId, Timestamp } from "../types/v3";
import { loadScreenEntity, saveScreenEntity } from "./screenStore";

export interface ScreenItemsDocument {
  screenId: ScreenId;
  updatedAt: Timestamp;
  items: ScreenItem[];
}

const _cache = new Map<string, ScreenItemsDocument>();

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

export function createEmptyScreenItems(screenId: string): ScreenItemsDocument {
  return {
    screenId: screenId as ScreenId,
    updatedAt: nowTs(),
    items: [],
  };
}

export function setItemsInCache(file: ScreenItemsDocument): void {
  _cache.set(file.screenId, { ...file, items: [...file.items] });
}

export function clearItemsFromCache(screenId: string): void {
  _cache.delete(screenId);
}

export async function loadScreenItems(screenId: string): Promise<ScreenItemsDocument> {
  const cached = _cache.get(screenId);
  if (cached) return { ...cached, items: [...cached.items] };

  const screen = await loadScreenEntity(screenId);
  return {
    screenId: screen.id as ScreenId,
    updatedAt: screen.updatedAt,
    items: [...(screen.items ?? [])],
  };
}

export async function saveScreenItems(file: ScreenItemsDocument): Promise<void> {
  const screen = await loadScreenEntity(file.screenId);
  await saveScreenEntity({
    ...screen,
    items: [...file.items],
    updatedAt: nowTs(),
  });
  _cache.delete(file.screenId);
}

export async function deleteScreenItems(screenId: string): Promise<void> {
  const screen = await loadScreenEntity(screenId);
  await saveScreenEntity({
    ...screen,
    items: [],
    updatedAt: nowTs(),
  });
  _cache.delete(screenId);
}
