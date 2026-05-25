/**
 * Rename refactor 進行中フラグ (I-7 Round 2 F-3 / #1299 Codex review M-4 / Opus review M-2)
 *
 * 用途: `handleRenameSuccess` 完了直後の短窓 (broadcast 受信 → editor.reload → load=null →
 * onNotFound) で発生する URL race condition を抑制する。
 *
 * 問題: rename / undo RPC 成功 → backend が `<entityType>Changed` broadcast を発火 →
 * 別 tab で開いていた editor (= rename 対象 entity を編集中) が broadcast を受けて
 * `reload()` を呼ぶ。reload は現在の URL params (= 旧 id or 新 id、どちらか navigate
 * 未完了側) で `load()` する。rename 完了後はその id が存在しないため null → onNotFound
 * → `/<entityType>/list` redirect。これは handleRenameSuccess 内の navigate(replace)
 * と race して、たまに list 経由に飛んでしまう。
 *
 * 対策: handleRenameSuccess の冒頭で `<entityType>:<id>` (oldId / newId 両方) を
 * suppress set に登録 + TTL 経過 (3000ms) で自動 expire。`useResourceEditor.reload()`
 * は load=null 時に `isRenameInProgress(entityType, id)` をチェックし、true なら
 * onNotFound を呼ばずに silent skip する。
 *
 * TTL は SPA 内 navigate 完了 + broadcast 配信 + reload load 完了が現実的に 3 秒で十分。
 * 漏れた場合 (例: backend 遅延) は通常通り `/<entityType>/list` に飛ぶ (degradation)。
 *
 * 注: 本フラグは UI 一時的な UX 補正のみが目的。データ整合性 / cache invalidation には
 * `_emitTableChangeForRename` / backend broadcast が別途責任を持つ。
 */

import { getRenameEntityMeta, type RenameEntityType } from "./renameEntityMapping";

const RENAME_IN_PROGRESS_TTL_MS = 3000;

// key=`${tabType}:${id}` の Set。tabType は useResourceEditor から渡されるため
// editor 側で entityType → tabType の mapping を持たずに済む。
const inFlight = new Map<string, number>(); // value=expireMs

function makeKey(tabType: string, id: string): string {
  return `${tabType}:${id}`;
}

function purgeExpired(now: number): void {
  for (const [key, expireMs] of inFlight) {
    if (expireMs <= now) inFlight.delete(key);
  }
}

/**
 * `<entityType>:<id>` を rename-in-progress set に登録する (TTL: 3000ms)。
 *
 * `handleRenameSuccess` / undo path から呼ぶ。oldId / newId 両方の登録を推奨
 * (どちらの URL がまだ navigate 未完了の editor に残っているか不明なため)。
 *
 * 内部 storage key は entityType → tabType に正規化する (useResourceEditor 側は
 * tabType しか持たないため)。
 */
export function markRenameInProgress(entityType: RenameEntityType, id: string): void {
  const tabType = getRenameEntityMeta(entityType).tabType;
  const now = Date.now();
  purgeExpired(now);
  inFlight.set(makeKey(tabType, id), now + RENAME_IN_PROGRESS_TTL_MS);
}

/**
 * `<tabType>:<id>` が rename-in-progress 中かを判定する (useResourceEditor 用)。
 *
 * `useResourceEditor.reload()` が `load(id)=null` の時に呼び、true なら
 * `onNotFound` の redirect を skip する。
 */
export function isRenameInProgressByTabType(tabType: string, id: string): boolean {
  const now = Date.now();
  purgeExpired(now);
  return inFlight.has(makeKey(tabType, id));
}

/**
 * test 用: rename-in-progress set を全消去する (vitest beforeEach 用)。
 */
export function _resetRenameInProgressForTest(): void {
  inFlight.clear();
}
