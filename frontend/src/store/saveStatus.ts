/**
 * 保存の状態の見える化 (UI 改善提案 第 5 弾 #83)。編集中の内容は、サーバに「下書き」として置かれ、「保存」で初めて原本に書かれる。
 * 下書きを最後にサーバへ送った時刻と、原本を最後に保存した時刻を、画面の保存ボタンのそばに出すための記録。
 * 原本を勝手に書き換える自動保存ではない (明示保存モデルのまま)。
 */
import { useSyncExternalStore } from "react";

export interface SaveStatus {
  /** 下書きを最後にサーバへ送った時刻 (ms)。まだ送っていなければ null */
  draftAt: number | null;
  /** 原本を最後に保存した時刻 (ms) */
  savedAt: number | null;
  /** 下書きを送るのに失敗している (次の成功まで) */
  draftFailed: boolean;
}

let state: SaveStatus = { draftAt: null, savedAt: null, draftFailed: false };
const listeners = new Set<() => void>();
const emit = (next: SaveStatus) => { state = next; listeners.forEach((l) => l()); };

export const saveStatus = {
  draftSynced(at = Date.now()): void { emit({ ...state, draftAt: at, draftFailed: false }); },
  draftFailed(): void { if (!state.draftFailed) emit({ ...state, draftFailed: true }); },
  /** 原本を保存した (下書きの記録は、新しい編集が始まるまで空にする) */
  saved(at = Date.now()): void { emit({ draftAt: null, savedAt: at, draftFailed: false }); },
  reset(): void { emit({ draftAt: null, savedAt: null, draftFailed: false }); },
  get(): SaveStatus { return state; },
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSaveStatus = (): SaveStatus => useSyncExternalStore(subscribe, () => state, () => state);

/** 「12:03」のような時刻 */
export function clockLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 保存ボタンのそばに出す、状態の文 */
export function describeSaveStatus(dirty: boolean | undefined, s: SaveStatus): { text: string; tone: "ok" | "warn" | "muted" } {
  if (dirty === false) return { text: s.savedAt ? `原本と同じ (${clockLabel(s.savedAt)} に保存)` : "原本と同じ", tone: "muted" };
  if (s.draftFailed) return { text: "原本に未反映 / 下書きをサーバへ送れていません", tone: "warn" };
  if (s.draftAt) return { text: `原本に未反映 / 下書きは ${clockLabel(s.draftAt)} にサーバへ保存済み`, tone: "ok" };
  return { text: "原本に未反映 / 下書きを送っています…", tone: "muted" };
}
