export const DESIGNER_REFERENCE_RELOAD_EVENTS = [
  "tableChanged",
  "processFlowChanged",
  "sequenceChanged",
  "viewChanged",
  "viewDefinitionChanged",
  "pageLayoutChanged",
] as const;

interface ScreenChangedPayload {
  screenId?: string;
  oldId?: string;
  reload?: boolean;
  deleted?: boolean;
}

export function shouldNotifyScreenChanged(data: unknown, screenId: string): boolean {
  const d = (data ?? {}) as ScreenChangedPayload;
  if (d.reload === true || d.oldId === screenId) return true;
  return d.screenId === screenId && !d.deleted;
}

export function isReloadBroadcast(data: unknown): boolean {
  return ((data ?? {}) as { reload?: boolean }).reload === true;
}
