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
