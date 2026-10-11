/**
 * 一覧の各行の「編集中」の印 (EditSessionBadge) が使う、編集セッションの問い合わせ。
 * 行ごとに問い合わせると、行数だけ往復する (テーブル 170 行 = 170 回)。種類ごとに 1 回だけ尋ね、
 * 同じ結果を共有する。変更の通知 (broadcast) があったら `invalidateSessionIndex()` で古い結果を捨てる
 * (一斉に尋ね直す各行のうち、最初の 1 件だけが問い合わせ、残りは同じ結果を使う)。
 */
import { mcpBridge } from "../mcp/mcpBridge";
import type { EditSessionData } from "../hooks/useEditSession";

/** 通知がなくても、結果を使い回す最長の時間 */
const MAX_AGE_MS = 5000;

const byType = new Map<string, { at: number; gen: number; promise: Promise<EditSessionData[]> }>();
/** 通知ごとに進める世代。問い合わせを始めたときの世代が古ければ、その結果は使わない */
let generation = 0;
const seenNotices = new WeakSet<object>();

/**
 * 変更の通知を受けたとき。これより前に始めた問い合わせの結果は使わない。
 * 同じ通知 (同じ `notice` オブジェクト) を各行が一斉に受けるときは、世代を 1 回だけ進める。
 */
export function invalidateSessionIndex(notice?: unknown): void {
  if (notice !== null && typeof notice === "object") {
    if (seenNotices.has(notice)) return;
    seenNotices.add(notice);
  }
  generation++;
}

/** 種類 (resourceType) の全セッション */
export function listSessionsOfType(resourceType: string): Promise<EditSessionData[]> {
  const now = Date.now();
  const hit = byType.get(resourceType);
  if (hit && hit.gen === generation && now - hit.at < MAX_AGE_MS) return hit.promise;
  const promise = (mcpBridge.request("editSession.list", { resourceType }) as Promise<{ sessions?: EditSessionData[] } | null>)
    .then((r) => r?.sessions ?? [])
    .catch((e) => { if (byType.get(resourceType)?.promise === promise) byType.delete(resourceType); throw e; });
  byType.set(resourceType, { at: now, gen: generation, promise });
  return promise;
}

/** 1 つの設計に対する、有効な (Active) セッション */
export async function listActiveSessionsFor(resourceType: string, resourceId: string): Promise<EditSessionData[]> {
  const all = await listSessionsOfType(resourceType);
  return all.filter((s) => s.state === "Active" && s.resourceId === resourceId);
}

/** テスト用 */
export function _resetEditSessionIndex(): void { byType.clear(); generation = 0; }
