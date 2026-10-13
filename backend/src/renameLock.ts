/**
 * rename の workspace mutex。同一ワークスペースに対する preview / rename / undo を直列化する (renameEntity.ts から分離)。
 */
// ── Workspace mutex (Phase I round 3+4 Should-fix SF-3) ─────────────────────
//
// 同一 workspace root に対する preview / rename / undo 全体を直列化する async mutex。
// 旧実装は単一 process 内でも `await` 境界で並行 invocation が起こり、_undoStore 上書き
// (SF-7 で別経路解消) や ref scan の中間状態 read 等の race を発生させていた。
// Node.js の単一スレッド実行でも `await` で event loop が他 task に処理権を譲るため、
// scan → write → push の atomic 性は明示的な lock で保証する必要がある。

const _workspaceLocks = new Map<string, Promise<unknown>>();

/**
 * workspace root 単位で async critical section を獲得する。
 * 戻り値の `release` 関数を必ず finally で呼ぶこと (await 不要)。
 */
export async function acquireWorkspaceLock(root: string): Promise<() => void> {
  const prev = _workspaceLocks.get(root) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  // chain 接続: prev が settle してから next を pending 中として登録
  const chained = prev.then(() => next);
  _workspaceLocks.set(root, chained);
  await prev;
  return () => {
    release!();
    // 最後尾の chain なら map から外す (GC + デバッグ性)
    if (_workspaceLocks.get(root) === chained) {
      _workspaceLocks.delete(root);
    }
  };
}

/** test-only: workspace lock 全クリア */
export function _clearWorkspaceLocksForTest(): void {
  _workspaceLocks.clear();
}

