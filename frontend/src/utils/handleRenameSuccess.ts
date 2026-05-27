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
  type TabType,
} from "../store/tabStore";
import { _emitTableChangeForRename } from "../store/tableStore";
import type { TableId } from "../types/v3/common";
import { getRenameEntityMeta, type RenameEntityType } from "./renameEntityMapping";
import { markRenameInProgress } from "./renameInProgress";

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
  /**
   * 現在の active workspace id (`useWorkspacePath().wsId`)。
   * I-7 Round 3 G-5 (#1299 Codex S-R2-1): multi-workspace 跨ぎでの
   * `renameInProgress` 誤抑制を防ぐため key に wsId を含める。
   * 省略時は従来動作 (`_` placeholder)。
   */
  wsId?: string;
  /**
   * #1330: rename 起動点が Designer / 各 entity 既定の editor 以外の場合に
   * tab / navigate 先を override する。
   *
   * - `originTabType`: rename 完了後に open する tab type (省略時は `meta.tabType`)。
   *   - Designer 起動 = undefined (default)
   *   - ScreenItemsView 起動 = "screen-items"
   *   - ScreenListView / ScreenFlow 起動 = undefined (per-resource tab を open しない)
   * - `originRoute`: rename 完了後の navigate 先 path (省略時は `meta.editRoute(newId)`)。
   *   - Items 起動 = `(id) => /screen/items/${id}`
   *   - List 起動 = `() => /screen/list`
   *   - Flow 起動 = `() => /screen/flow`
   * - `skipOpenNewTab`: true なら新 tab を開かず navigate のみ。List / Flow singleton 起動用。
   *
   * 注: oldId の meta.tabType tab は常に close する (stale design tab 防止)。
   *     originTabType が meta.tabType と異なる場合、追加で originTabType:oldId も close する。
   */
  originTabType?: TabType;
  originRoute?: (newId: string) => string;
  skipOpenNewTab?: boolean;
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
  wsId,
  originTabType,
  originRoute,
  skipOpenNewTab,
}: HandleRenameSuccessParams): void {
  const meta = getRenameEntityMeta(entityType);
  const effectiveTabType: TabType = originTabType ?? meta.tabType;

  // I-7 Round 2 F-3 (#1299 Codex review M-4 / Opus review M-2):
  // rename / undo 完了直後の窓 (broadcast 受信→reload→load(currentUrlId)=null) で
  // useResourceEditor.reload() が onNotFound を呼んで /<entityType>/list に redirect する
  // race を防ぐ。oldId / newId 双方を suppress set に登録し、editor が短窓内で stale
  // current-url-id の load 結果が null でも redirect しないようにする。
  // 旧 url の load (rename 前) は null になり、新 url への navigate が SPA 上で確定する。
  // Round 3 G-5: wsId を渡して multi-workspace 跨ぎの誤抑制を防ぐ。
  markRenameInProgress(entityType, oldId, wsId);
  markRenameInProgress(entityType, newId, wsId);

  // 旧 meta tab は常に close (stale 防止; Screen の場合 design:oldId が stale になる)。
  // #1330: ItemsView 起動など originTabType が meta.tabType と異なる場合、追加で
  //        originTabType:oldId も close (両方の stale tab を一度に掃除)。
  closeTab(makeTabId(meta.tabType, oldId), true);
  if (originTabType && originTabType !== meta.tabType) {
    closeTab(makeTabId(originTabType, oldId), true);
  }

  // 新 tab を開く (#1330: skipOpenNewTab=true なら open せず navigate のみ。
  // List / Flow singleton 起動はその場 (一覧/フロー画面) に留まる)。
  if (!skipOpenNewTab) {
    openTab({
      id: makeTabId(effectiveTabType, newId),
      type: effectiveTabType,
      resourceId: newId,
      label: label && label.length > 0 ? label : newId,
    });
  }

  // URL を navigate (#1330: originRoute 優先、無ければ meta.editRoute)
  const targetPath = originRoute ? originRoute(newId) : meta.editRoute(newId);
  navigate(wsPath(targetPath), { replace: true });

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
