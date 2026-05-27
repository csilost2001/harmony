/**
 * presence.ts (#1380 で `@harmony/shared` に集約)
 *
 * 編集者プレゼンス (在席状況) の Activity level 型定義。
 * docs/spec/collab-presence.md § 9 (Activity taxonomy) で定義された 5 段階を表す。
 *
 * 経緯:
 *   - backend `src/presenceManager.ts` と frontend `src/hooks/usePresenceRegistry.ts`
 *     に同一型定義が複製されていた (backend が server-compute して broadcast、
 *     frontend が UI badge / list 表示に使用)。
 *   - `classifyActivity` 関数本体は backend が `presenceConfig` (env-aware threshold)
 *     参照、frontend が hardcode (Phase 5 暫定) のため共通化対象外。型のみ shared 化する。
 *   - PR #1378 (#1375) で `@harmony/shared` package を新設後、本 #1380 で型集約。
 */

/**
 * docs/spec/collab-presence.md § 9 の 5 段階 activity level。
 * - `live`: WS 接続中 + 直近の編集操作あり (lastEditAt がしきい値以内)
 * - `active`: WS 接続中 + 直近のアクティビティあり (lastActivityAt がしきい値以内)
 * - `idle`: lastActivityAt が idle しきい値内 (WS 切断含む)
 * - `stale`: WS 接続中だがアクティビティ無し (長時間放置)
 * - `abandoned`: WS 切断 + idle しきい値超過 (削除候補)
 */
export type ActivityLevel = "live" | "active" | "idle" | "stale" | "abandoned";
