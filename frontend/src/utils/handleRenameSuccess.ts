/**
 * Rename refactor 成功後の共通後処理 helper (#1298 I-6, RFC #1284)。
 *
 * 各 editor の `RenameEntityDialog.onSuccess` から呼ぶ。本 helper の責務は:
 *   1. 旧 tab を閉じる (force=true: refactor 完了で dirty 概念は意味なし)
 *   2. 新 tab を開く + active 化
 *   3. URL を新 id の edit ページに hard redirect
 *
 * store cache 無効化は backend が `<entityType>Changed` event を broadcast し、
 * 各 store が onChange 経由で reload するため、本 helper では明示呼び出しない。
 * (broadcast race を避けたい一部 editor は独自に reload を追加してよい)
 */
import {
  closeTab,
  openTab,
  makeTabId,
} from "../store/tabStore";
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
}
