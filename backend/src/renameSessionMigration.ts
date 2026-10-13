/**
 * rename に伴う、編集履歴 (.edit-sessions-history) と編集セッションの対象 id の移行 (renameEntity.ts から分離)。
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logWarn } from "./serverLog.js";
import type { EditSessionMigrationResult, RenameOpts } from "./renameTypes.js";

async function fileExists(absPath: string): Promise<boolean> {
  try { await fs.access(absPath); return true; } catch { return false; }
}

// ── Phase I round 3+4 Should-fix SF-4 / SF-5 / SF-6: history + edit-sessions migration ─

/**
 * `<root>/.edit-sessions-history/<resourceType>/<oldId>/` を `.../<newId>/` に atomic rename。
 * (Phase I round 3+4 Should-fix SF-5)
 *
 * entity の history continuity を rename 後も保つため。directory 不在は no-op。
 *
 * Phase J Should-fix SF-ε / Nit N-4 (#1298 round 5 Codex S-1 / Opus N-4): 戻り値を
 * `{migrated, warning?}` に拡張。toDir 既存衝突 / write 失敗を warnings 経路に乗せて
 * 設計者へ通知する (旧実装は silent skip だった)。
 */
export async function migrateHistoryDirectory(
  root: string, resourceType: string, oldId: string, newId: string,
): Promise<{ migrated: boolean; warning?: string }> {
  const fromDir = path.join(root, ".edit-sessions-history", resourceType, oldId);
  const toDir = path.join(root, ".edit-sessions-history", resourceType, newId);
  if (!(await fileExists(fromDir))) return { migrated: false };
  if (await fileExists(toDir)) {
    // 衝突: 既に新 id directory が存在 — merge は危険なので skip (旧 silent skip → warning に propagation)
    return {
      migrated: false,
      warning: `history migration skip (${resourceType}): toDir "${newId}" が既存のため orphan 化リスクあり。手動 merge / 削除を検討してください。`,
    };
  }
  try {
    await fs.mkdir(path.dirname(toDir), { recursive: true });
    await fs.rename(fromDir, toDir);
  } catch (e) {
    return {
      migrated: false,
      warning: `history migration 失敗 (${resourceType}/${oldId}): ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // history JSON 内の `resourceId` field も書き換える (entry が listHistory({resourceId: newId})
  // で検索可能になるよう)
  try {
    const files = await fs.readdir(toDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const filePath = path.join(toDir, f);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (data.resourceId === oldId) {
          data.resourceId = newId;
          await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
        }
      } catch { /* 壊れた JSON は skip */ }
    }
  } catch { /* readdir 失敗は ignore */ }

  return { migrated: true };
}

/**
 * `<root>/.edit-sessions/*.json` を scan し、content.resourceType === <kebab> &&
 * content.resourceId === oldId のものを newId に書き換える。
 * (Phase I round 3+4 Should-fix SF-4 / SF-6)
 *
 * state (Active / Discarded) や role (Edit / View) は問わず全件書換。Phase G M-4
 * detectConcurrentEditRefs は active Edit のみ block するため、Discarded 残骸 / View
 * session は通過して stale resourceId のまま残るのを防ぐ。
 *
 * 戻り値: 書換えた session の migration log (undo で逆方向書戻し用)。
 */
export async function migrateEditSessions(
  root: string, kebabResourceType: string, oldId: string, newId: string,
): Promise<Array<{ editSessionId: string; oldResourceId: string; newResourceId: string }>> {
  const dir = path.join(root, ".edit-sessions");
  const log: Array<{ editSessionId: string; oldResourceId: string; newResourceId: string }> = [];
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch { return log; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    if (f.includes(".tmp-")) continue; // in-flight atomic write は skip
    const filePath = path.join(dir, f);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data.resourceType === kebabResourceType && data.resourceId === oldId) {
        data.resourceId = newId;
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
        const id = typeof data.id === "string" ? data.id : f.replace(/\.json$/, "");
        log.push({ editSessionId: id, oldResourceId: oldId, newResourceId: newId });
      }
    } catch { /* 壊れた JSON / 書込み失敗は skip (best effort、rename commit を block しない) */ }
  }
  return log;
}

/**
 * undo 用: edit-sessions migration を逆方向に書き戻す。
 *
 * Phase J Must-fix C: bridge API 経由優先 (live store + persisted 同期更新)、
 * opts.migrateEditSessions 未指定時のみ raw fs fallback。
 */
export async function revertEditSessionsMigration(
  root: string,
  opts: RenameOpts | undefined,
  migrations: Array<{
    editSessionId: string;
    oldResourceId: string;
    newResourceId: string;
    resourceType?: string;
  }>,
): Promise<string[]> {
  const warnings: string[] = [];
  // bridge 経由 (live + persisted): resourceType ごとに集約して 1 回ずつ revert (oldId と newId
  // を swap して同 API を再利用)
  if (opts?.migrateEditSessions) {
    // resourceType + oldResourceId をキーに集約
    const byKey = new Map<string, {
      resourceType: string;
      oldResourceId: string;
      newResourceId: string;
      editSessionIds: string[];
    }>();
    for (const m of migrations) {
      const rt = m.resourceType ?? "";
      if (!rt) continue;
      const key = `${rt}:${m.oldResourceId}:${m.newResourceId}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.editSessionIds.push(m.editSessionId);
      } else {
        byKey.set(key, {
          resourceType: rt,
          oldResourceId: m.oldResourceId,
          newResourceId: m.newResourceId,
          editSessionIds: [m.editSessionId],
        });
      }
    }
    for (const { resourceType, oldResourceId, newResourceId, editSessionIds } of byKey.values()) {
      // newResourceId → oldResourceId に戻す (swap)
      try {
        const result = normalizeMigrationResult(
          await opts.migrateEditSessions(resourceType, newResourceId, oldResourceId, editSessionIds),
        );
        warnings.push(...result.warnings);
      } catch (e) {
        warnings.push(`edit-session reverse migration 失敗: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return warnings;
  }
  // fallback: 旧 raw fs (test path / standalone path)
  const dir = path.join(root, ".edit-sessions");
  for (const m of migrations) {
    const filePath = path.join(dir, `${m.editSessionId}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data.resourceId === m.newResourceId) {
        data.resourceId = m.oldResourceId;
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      }
    } catch { /* best effort */ }
  }
  return warnings;
}

export function normalizeMigrationResult(
  result: Array<{ editSessionId: string; oldResourceId: string; newResourceId: string }> | EditSessionMigrationResult,
): EditSessionMigrationResult {
  return Array.isArray(result) ? { migrated: result, warnings: [] } : result;
}

/**
 * Phase J Must-fix C (#1298 round 5 Codex M-3): edit-session migration の bridge 経由実装。
 * opts.migrateEditSessions が渡されていればそれを使い、未指定なら旧 raw fs 経路に fallback する。
 */
export async function migrateEditSessionsByBridge(
  opts: RenameOpts | undefined,
  resourceType: string,
  oldId: string,
  newId: string,
  root: string,
): Promise<EditSessionMigrationResult> {
  if (opts?.migrateEditSessions) {
    return normalizeMigrationResult(await opts.migrateEditSessions(resourceType, oldId, newId));
  }
  // fallback: 旧 raw fs (test path / standalone path)
  return { migrated: await migrateEditSessions(root, resourceType, oldId, newId), warnings: [] };
}

