/**
 * Rename refactor 成功後の共通後処理 helper (#1298 I-6, RFC #1284)。
 *
 * 各 editor の `RenameEntityDialog.onSuccess` から呼ぶ。本 helper の責務は:
 *   1. 旧 tab を閉じる (force=true: refactor 完了で dirty 概念は意味なし)
 *   2. 新 tab を開く + active 化
 *   3. URL を新 id の edit ページに hard redirect
 *   4. Phase J Must-fix E (#1298 round 4 Antigravity M-7): 同一 client 内の local pubsub に
 *      rename 通知を発行し、stale cache を即時 invalidate する。
 *      backend broadcast (`<entityType>Changed`) は network round trip があるため、
 *      同期発火する local pubsub と併用する (二重通知だが listener 側 idempotent 前提)。
 *
 * store cache 無効化は backend が `<entityType>Changed` event を broadcast し、
 * 各 store が onChange 経由で reload するため、本 helper の local emit は cache 整合性の
 * **safety net** として機能する (broadcast 到達前の SPA 遷移先 stale 読み取りを防ぐ)。
 */
import {
  closeTab,
  openTab,
  makeTabId,
} from "../store/tabStore";
import { _emitTableChangeForRename } from "../store/tableStore";
import type { TableId } from "../types/v3/common";
import { getRenameEntityMeta, type RenameEntityType } from "./renameEntityMapping";

export interface HandleRenameSuccessParams {
  entityType: RenameEntityType;
  oldId: string;
  newId: string;
  /** tab label (entity の物理名 / display name 等。空の場合は newId を fallback) */
  label: string;
  /** react-router `navigate` */
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  /** `useWorkspacePath().wsPath` */
  wsPath: (path: string) => string;
}

/**
 * tab を旧 → 新に差し替えて URL を新 id に navigate する。
 *
 * 注意: 本 helper の呼出箇所は **rename 成功直後** (RPC 戻り値受信時) のみ。preview や
 * undo の post-処理は別 path。undo 時は dialog 内 toast 経由で別 navigate を行う。
 */
export function handleRenameSuccess({
  entityType,
  oldId,
  newId,
  label,
  navigate,
  wsPath,
}: HandleRenameSuccessParams): void {
  const meta = getRenameEntityMeta(entityType);
  const oldTabId = makeTabId(meta.tabType, oldId);
  const newTabId = makeTabId(meta.tabType, newId);

  // 旧 tab は force=true で閉じる (refactor 完了で dirty 警告は不要)
  closeTab(oldTabId, true);

  // 新 tab を開く (既存なら label 更新 + active)
  openTab({
    id: newTabId,
    type: meta.tabType,
    resourceId: newId,
    label: label && label.length > 0 ? label : newId,
  });

  // URL を新 id に hard redirect (replace=true で履歴汚染を防ぐ)
  navigate(wsPath(meta.editRoute(newId)), { replace: true });

  // Phase J Must-fix E (#1298 round 4 Antigravity M-7): 同一 client 内 local pubsub に
  // rename 通知を発行。backend broadcast (`<entityType>Changed`) は network round trip が
  // あるため、SPA 遷移先 (例: ViewDefinitionEditor の useTableOptions / FlowEditor の
  // ProcessFlow cache) が broadcast 到達前に stale データを読む経路があった。
  // 本 emit で同期的に invalidate する。
  //
  // 現状 local pubsub を持つ store は tableStore のみ (#1001 で導入)。他 entity 種別は
  // 既存購読が全て mcpBridge.onBroadcast 経由のため、backend broadcast の origin 配信
  // (Phase I で excludeClientId 廃止済) で十分。Table のみ `onTableChange` (local) と
  // `tableChanged` (broadcast) の二系統購読パターン (`useViewDefinitionTables` 等) があるため
  // 確実に invalidate する責務がある。
  if (entityType === "table") {
    try {
      _emitTableChangeForRename({ tableId: newId as TableId });
      // undo の場合 oldId と newId が swap されるため、ここでは「新 ID = 現在の正」を通知する
      // (rename 経路: newId = 確定後 id、undo 経路: newId = oldId に戻った後 id)。
      // 削除でないため `deleted` flag は付けない。
    } catch (e) {
      console.warn("[handleRenameSuccess] local emit failed:", e);
    }
  }
}
