/**
 * 更新の案内。前回このブラウザで見た版・コミットと、いまのサーバのそれが違えば、「更新されました」と知らせる (初回は知らせない)。
 * 見た版は、このブラウザの localStorage にだけ保存する。
 */
const KEY = "harmony.seenVersion";

export interface VersionStamp { version: string; commit?: string }
const stampOf = (v: VersionStamp): string => `${v.version}+${v.commit ?? ""}`;

export function readSeenVersion(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
export function markVersionSeen(v: VersionStamp): void { try { localStorage.setItem(KEY, stampOf(v)); } catch { /* 保存できなくても、画面は動く */ } }

/** 前回と違うか (前回が無いときは、違わない扱い = 初回は知らせない) */
export function versionChanged(v: VersionStamp, seen: string | null = readSeenVersion()): boolean {
  return seen !== null && seen !== stampOf(v);
}

// ── 「新しくなったこと」の案内 (続編 第 10 弾 #190) ─────────────────────────
const NOTE_KEY = "harmony.seenNote";
export interface ReleaseNoteLike { date: string; title: string; pr?: string }
export const noteKeyOf = (n: ReleaseNoteLike): string => `${n.date}|${n.title}`;

export function readSeenNote(): string | null { try { return localStorage.getItem(NOTE_KEY); } catch { return null; } }
export function markNoteSeen(n: ReleaseNoteLike | undefined): void { if (n) { try { localStorage.setItem(NOTE_KEY, noteKeyOf(n)); } catch { /* 保存できなくても、画面は動く */ } } }

export const WHATS_NEW_MAX = 5;

/**
 * 前に見たリリースノートより新しいもの (新しい順の一覧の先頭から、前に見たものの手前まで)。最大 5 件。
 * 前に見たものが一覧に無いとき (古くなって一覧から落ちた) は、新しい 5 件。リリースノートが無ければ空。
 */
export function pickNewNotes<T extends ReleaseNoteLike>(notes: readonly T[], seenKey: string | null, max = WHATS_NEW_MAX): T[] {
  if (notes.length === 0) return [];
  const i = seenKey === null ? -1 : notes.findIndex((n) => noteKeyOf(n) === seenKey);
  if (i === 0) return [];
  return (i < 0 ? [...notes] : notes.slice(0, i)).slice(0, max);
}
