/**
 * draftHistoryStore.ts (#893)
 *
 * EditSession の discard / transferEdit / save 時の payload スナップショットを
 * 7 日間ファイル保持する履歴ストア。
 *
 * FS パス: <workspaceRoot>/.edit-sessions-history/<resourceType>/<resourceId>/<historyId>.json
 *
 * historyId = "<isoTimestamp>--<sessionId>" (区切りを "--" 二重ハイフンにして timestamp / ID 内の
 * "-" と衝突させない。Windows 互換のため timestamp のコロンは "-" に置換)
 */

import fs from "fs/promises";
import path from "path";

// ── 公開型定義 ────────────────────────────────────────────────────────────────

export type DraftHistoryReason = "discard" | "transferEdit" | "save";

export interface DraftHistoryEntry {
  historyId: string;
  timestamp: string; // ISO8601
  editSessionId: string;
  ownerSessionId: string;
  ownerLabel: string;
  reason: DraftHistoryReason;
  resourceType: string;
  resourceId: string;
  snapshot: unknown;
}

// ── FS ヘルパー ───────────────────────────────────────────────────────────────

const HISTORY_DIR = ".edit-sessions-history";

function historyDir(workspaceRoot: string, resourceType: string, resourceId: string): string {
  return path.join(workspaceRoot, HISTORY_DIR, resourceType, resourceId);
}

function historyFilePath(
  workspaceRoot: string,
  resourceType: string,
  resourceId: string,
  historyId: string,
): string {
  return path.join(historyDir(workspaceRoot, resourceType, resourceId), `${historyId}.json`);
}

/**
 * ISO8601 タイムスタンプを historyId 安全な文字列に変換する。
 * コロン ":" は Windows ファイル名不可のため "-" に置換する。
 * 例: "2026-05-07T18:30:00.000Z" → "2026-05-07T18-30-00.000Z"
 */
function timestampToFileSegment(isoString: string): string {
  return isoString.replace(/:/g, "-");
}

/**
 * historyId を生成する。
 * 形式: "<timestamp-safe>--<sessionId-prefix-8>-<randomSuffix-4>"
 * "--" (二重ハイフン) を区切り文字として timestamp と sessionId を分ける。
 */
export function generateHistoryId(timestamp: string, sessionId: string): string {
  const ts = timestampToFileSegment(timestamp);
  const idPrefix = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  // ミリ秒 + ランダム 4 桁で衝突回避
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}--${idPrefix}-${rand}`;
}

// ── DraftHistoryStore ─────────────────────────────────────────────────────────

/**
 * EditSession スナップショットの履歴を workspace 単位で管理するストア。
 *
 * 設計方針:
 * - 副作用最小化: read/write のみ担当し、EditSession 作成等は wsBridge ハンドラ側で実施
 * - FS パスが長くなるため resourceType / resourceId 別ディレクトリ構造
 */
export class DraftHistoryStore {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * スナップショットを保存する。
   * discard / transferEdit / save 時に EditSessionStore の hook から呼ばれる。
   */
  async saveSnapshot(params: {
    resourceType: string;
    resourceId: string;
    editSessionId: string;
    ownerSessionId: string;
    ownerLabel: string;
    reason: DraftHistoryReason;
    snapshot: unknown;
  }): Promise<DraftHistoryEntry> {
    const { resourceType, resourceId, editSessionId, ownerSessionId, ownerLabel, reason, snapshot } = params;
    const timestamp = new Date().toISOString();
    const historyId = generateHistoryId(timestamp, editSessionId);

    const entry: DraftHistoryEntry = {
      historyId,
      timestamp,
      editSessionId,
      ownerSessionId,
      ownerLabel,
      reason,
      resourceType,
      resourceId,
      snapshot,
    };

    const dir = historyDir(this.workspaceRoot, resourceType, resourceId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = historyFilePath(this.workspaceRoot, resourceType, resourceId, historyId);

    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");
    return entry;
  }

  /**
   * 指定リソースの履歴エントリ一覧を timestamp 降順で返す。
   * エントリには snapshot も含む (modal preview のため)。
   */
  async listHistory(params: {
    resourceType: string;
    resourceId: string;
  }): Promise<DraftHistoryEntry[]> {
    const { resourceType, resourceId } = params;
    const dir = historyDir(this.workspaceRoot, resourceType, resourceId);

    let files: string[];
    try {
      const entries = await fs.readdir(dir);
      files = entries.filter((f) => f.endsWith(".json"));
    } catch {
      // ディレクトリが存在しない場合は空配列
      return [];
    }

    const results: DraftHistoryEntry[] = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const entry = JSON.parse(content) as DraftHistoryEntry;
        results.push(entry);
      } catch {
        // 破損ファイルは無視
      }
    }

    // timestamp 降順でソート
    results.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return tb - ta;
    });

    return results;
  }

  /**
   * historyId から単一エントリを読み込む。
   * restoreFromHistory 時に使用。snapshot を含む完全なエントリを返す。
   *
   * historyId からリソース情報を取得するため、全リソースディレクトリを検索する。
   */
  async restoreFromHistory(params: { historyId: string }): Promise<DraftHistoryEntry | null> {
    const { historyId } = params;
    const baseDir = path.join(this.workspaceRoot, HISTORY_DIR);

    // historyId.json を全ディレクトリから glob 的に検索
    let resourceTypes: string[];
    try {
      resourceTypes = await fs.readdir(baseDir);
    } catch {
      return null;
    }

    for (const resourceType of resourceTypes) {
      const rtDir = path.join(baseDir, resourceType);
      let resourceIds: string[];
      try {
        resourceIds = await fs.readdir(rtDir);
      } catch {
        continue;
      }

      for (const resourceId of resourceIds) {
        const filePath = path.join(rtDir, resourceId, `${historyId}.json`);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          return JSON.parse(content) as DraftHistoryEntry;
        } catch {
          // ファイルが存在しない場合は次へ
        }
      }
    }

    return null;
  }

  /**
   * olderThanDays 日より古い履歴ファイルを削除する (7 日 TTL)。
   * 削除した historyId の配列を返す。
   */
  async cleanupExpired(params: { olderThanDays?: number } = {}): Promise<string[]> {
    const { olderThanDays = 7 } = params;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const baseDir = path.join(this.workspaceRoot, HISTORY_DIR);
    const deleted: string[] = [];

    let resourceTypes: string[];
    try {
      resourceTypes = await fs.readdir(baseDir);
    } catch {
      return deleted;
    }

    for (const resourceType of resourceTypes) {
      const rtDir = path.join(baseDir, resourceType);
      let resourceIds: string[];
      try {
        resourceIds = await fs.readdir(rtDir);
      } catch {
        continue;
      }

      for (const resourceId of resourceIds) {
        const ridDir = path.join(rtDir, resourceId);
        let files: string[];
        try {
          const entries = await fs.readdir(ridDir);
          files = entries.filter((f) => f.endsWith(".json"));
        } catch {
          continue;
        }

        for (const file of files) {
          const filePath = path.join(ridDir, file);
          try {
            const stat = await fs.stat(filePath);
            if (stat.mtimeMs < cutoff) {
              await fs.unlink(filePath);
              const historyId = file.replace(/\.json$/, "");
              deleted.push(historyId);
            }
          } catch {
            // ignore
          }
        }

        // 空ディレクトリを削除 (任意、エラーは無視)
        try {
          const remaining = await fs.readdir(ridDir);
          if (remaining.length === 0) await fs.rmdir(ridDir);
        } catch {
          // ignore
        }
      }
    }

    return deleted;
  }
}
