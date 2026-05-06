/**
 * serverMtime.ts
 *
 * サーバー側ファイルの更新時刻 (mtime) を取得するユーティリティ。
 * タブを開いた/フォーカスした時のサーバー差分検知、
 * 未保存ドラフトが古いバージョン由来かどうかの判定に使用する。
 */
import { mcpBridge } from "../mcp/mcpBridge";

export type MtimeKind = "project" | "screen" | "screenEntity" | "table" | "processFlow" | "erLayout" | "customBlocks" | "conventions" | "screenItems" | "sequence" | "view" | "viewDefinition";

const LAST_SEEN_PREFIX = "mtime-";

/** サーバーから最新の mtime を取得（未接続または未存在なら null） */
export async function fetchServerMtime(kind: MtimeKind, id?: string): Promise<number | null> {
  try {
    const res = await mcpBridge.request("getFileMtime", { kind, id }) as { mtime: number | null };
    return res?.mtime ?? null;
  } catch {
    return null;
  }
}

function lastSeenKey(kind: MtimeKind, id?: string): string {
  return `${LAST_SEEN_PREFIX}${kind}${id ? `-${id}` : ""}`;
}

/** ブラウザが最後に認識したサーバー mtime を取得 */
export function getLastSeenMtime(kind: MtimeKind, id?: string): number | null {
  try {
    const raw = localStorage.getItem(lastSeenKey(kind, id));
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** 最後に認識したサーバー mtime を記録 */
export function setLastSeenMtime(kind: MtimeKind, id: string | undefined, mtime: number): void {
  try {
    localStorage.setItem(lastSeenKey(kind, id), String(mtime));
  } catch { /* ignore */ }
}

export function clearLastSeenMtime(kind: MtimeKind, id?: string): void {
  try {
    localStorage.removeItem(lastSeenKey(kind, id));
  } catch { /* ignore */ }
}

/**
 * サーバーと比較し、前回認識時より新しければ true を返す。
 * 戻り値が true の場合、呼び出し側はバナー表示等の対応を行う想定。
 * 初回（前回認識なし）は常に false を返し、現在の mtime を記録する。
 */
export async function hasServerBeenUpdated(kind: MtimeKind, id?: string): Promise<boolean> {
  const current = await fetchServerMtime(kind, id);
  if (current === null) return false;
  const last = getLastSeenMtime(kind, id);
  if (last === null) {
    setLastSeenMtime(kind, id, current);
    return false;
  }
  if (current > last) {
    // 更新を検知しても lastSeen は呼び出し側が「認識した」と明示するまで更新しない
    return true;
  }
  return false;
}

/** 呼び出し側が「変更を認識した」として lastSeen を現在値に追従させる */
export async function acknowledgeServerMtime(kind: MtimeKind, id?: string): Promise<void> {
  const current = await fetchServerMtime(kind, id);
  if (current !== null) setLastSeenMtime(kind, id, current);
}
