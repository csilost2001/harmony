export function saveDraft<T>(kind: string, id: string, data: T): void {
  try {
    localStorage.setItem(`draft-${kind}-${id}`, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function loadDraft<T>(kind: string, id: string): T | null {
  try {
    const raw = localStorage.getItem(`draft-${kind}-${id}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function clearDraft(kind: string, id: string): void {
  try {
    localStorage.removeItem(`draft-${kind}-${id}`);
  } catch { /* ignore */ }
}

export interface DraftMeta {
  kind: string;
  id: string;
  key: string;
  size: number;
}

/** localStorage 内の全ドラフトを列挙（Issue D ダッシュボードの未永続化ドラフトパネル等で使用） */
export function listAllDrafts(): DraftMeta[] {
  const out: DraftMeta[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("draft-")) continue;
      // "draft-<kind>-<id>" の id 部分は UUID でハイフンを含むため、最初のハイフンで split
      const rest = key.slice("draft-".length);
      const firstDash = rest.indexOf("-");
      if (firstDash < 0) continue;
      const kind = rest.slice(0, firstDash);
      const id = rest.slice(firstDash + 1);
      const value = localStorage.getItem(key) ?? "";
      out.push({ kind, id, key, size: value.length });
    }
  } catch { /* ignore */ }
  return out;
}

/** 指定 kind/id にドラフトが存在するか */
export function hasDraft(kind: string, id: string): boolean {
  try {
    return localStorage.getItem(`draft-${kind}-${id}`) !== null;
  } catch {
    return false;
  }
}
