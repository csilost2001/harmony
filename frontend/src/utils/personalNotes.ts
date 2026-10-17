/**
 * 個人メモ (UI 改善提案 続編 第 9 弾 #173)。設計ごとの、自分だけが見るメモ。原本 (設計の JSON) にも、マーカーにも書かない。
 * ブラウザの localStorage に、ワークスペースごとに覚える (別のブラウザ・別の人には見えない。ブラウザの保存領域を消すと消える)。
 * 「今日」の印を付けると、ダッシュボードの「今日やること」に出る。
 */
export interface PersonalNote { text: string; today: boolean; at: string }
export type NotesMap = Record<string, PersonalNote>;

export const MAX_NOTES = 300;
export const MAX_NOTE_CHARS = 2000;
export const notesKey = (wsId: string | undefined) => `harmony-personal-notes:${wsId ?? "default"}`;
/** 設計 1 件の印 (`<種類>:<id>`。種類は監査ログ・マーカーと同じ呼び名: table / processFlow / screen ...) */
export const noteRef = (kind: string, id: string) => `${kind}:${id}`;

export function loadNotes(wsId: string | undefined): NotesMap {
  try {
    const raw = JSON.parse(localStorage.getItem(notesKey(wsId)) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: NotesMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = v as Partial<PersonalNote> | null;
      if (n && typeof n.text === "string" && n.text.trim()) out[k] = { text: n.text.slice(0, MAX_NOTE_CHARS), today: n.today === true, at: typeof n.at === "string" ? n.at : "" };
    }
    return out;
  } catch { return {}; }
}

/** メモを書く (空にすると消す)。保存できたか (件数の上限・ブラウザの保存領域) を返す */
export function saveNote(wsId: string | undefined, ref: string, text: string, today: boolean, now: Date = new Date()): { ok: boolean; notes: NotesMap } {
  const notes = loadNotes(wsId);
  const body = text.slice(0, MAX_NOTE_CHARS);
  if (!body.trim()) delete notes[ref];
  else {
    if (!(ref in notes) && Object.keys(notes).length >= MAX_NOTES) return { ok: false, notes };
    notes[ref] = { text: body, today, at: now.toISOString() };
  }
  try { localStorage.setItem(notesKey(wsId), JSON.stringify(notes)); return { ok: true, notes }; } catch { return { ok: false, notes }; }
}

/** 「今日」の印のあるメモ (新しい順) */
export function todayNotes(notes: NotesMap): Array<{ ref: string; note: PersonalNote }> {
  return Object.entries(notes).filter(([, n]) => n.today).map(([ref, note]) => ({ ref, note })).sort((a, b) => b.note.at.localeCompare(a.note.at));
}

export function clearNotes(wsId: string | undefined): void {
  try { localStorage.removeItem(notesKey(wsId)); } catch { /* 無視 */ }
}
