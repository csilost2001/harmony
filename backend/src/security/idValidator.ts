/**
 * リソース ID / name / kind の入力 validator (S-002, #1225)
 *
 * handler 層 (入口) で呼ぶ。storage 層の path 組立前に validation する。
 * storage 層は defense-in-depth として assertPathContained を使う。
 */

import * as path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
// kind: lowercase alpha 先頭、以降は lowercase alphanumeric / hyphen / colon (namespace:kind 形式許可)
const SAFE_KIND_RE = /^[a-z][a-z0-9:-]{0,63}$/;
// EntityId: kebab-case 英単語、ファイル名 / URL / @参照 / JSON ref 値に使用 (RFC #1284 / メタ #1292)
// schemas/v3/common.v3.schema.json#EntityId の pattern と一致させること:
//   pattern: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$  minLength: 1  maxLength: 64
const ENTITY_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ENTITY_ID_MAX_LENGTH = 64;
// historyId: "<ISO-timestamp-safe>--<sessionId-prefix>-<rand>" 形式
// ISO timestamp はコロンを "-" に置換済: 例 "2026-05-19T10-30-00.000Z--abc123-xy12"
// 許容文字: 数字 / 大小英字 / "." / "_" / ":" / "-" (パスセパレータ / ".." は不可)
const HISTORY_ID_RE = /^[0-9A-Za-z._:-]{1,128}$/;

// ── 型ガード ───────────────────────────────────────────────────────────────────

export function isValidUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

export function isValidSafeName(s: unknown): s is string {
  return typeof s === "string" && SAFE_NAME_RE.test(s);
}

export function isValidKind(s: unknown): s is string {
  return typeof s === "string" && SAFE_KIND_RE.test(s);
}

/**
 * EntityId 形式 (kebab-case 英単語) かどうかを判定する (RFC #1284 / メタ #1292)。
 *
 * schemas/v3/common.v3.schema.json#EntityId の pattern + minLength/maxLength と一致させる:
 *   - pattern: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$
 *   - minLength: 1
 *   - maxLength: 64
 *
 * 用途: Screen / Table / ProcessFlow / Sequence / View / ViewDefinition / PageLayout の
 * top-level entity id (ファイル名 / URL / @参照 / JSON ref 値)。
 * step/edge/column 等の intra-entity local id (LocalId) は本 validator の対象外。
 */
export function isValidEntityId(s: unknown): s is string {
  return typeof s === "string" && s.length <= ENTITY_ID_MAX_LENGTH && ENTITY_ID_RE.test(s);
}

/**
 * EntityId | UUID v4 のどちらかを accept する (RFC #1284 移行期間 compat)。
 *
 * I-3 (examples migration) 完了前は既存 examples の `<UUID>.json` を読む必要があるため、
 * handler / wsHandler 入口は本 validator で両形式を accept する。
 * I-3 完了後の I-7 で `assertEntityIdOrUuid` → `assertEntityId` に締め切る (本 ISSUE スコープ外)。
 */
export function isValidEntityIdOrUuid(s: unknown): s is string {
  return isValidEntityId(s) || isValidUuid(s);
}

// ── assert 系 (throw on fail) ─────────────────────────────────────────────────

export function assertUuid(s: unknown, label: string): string {
  if (!isValidUuid(s)) {
    throw new Error(`Invalid ${label}: must be UUID (got ${JSON.stringify(s)})`);
  }
  return s;
}

export function assertSafeName(s: unknown, label: string): string {
  if (!isValidSafeName(s)) {
    throw new Error(`Invalid ${label}: must match [A-Za-z0-9_-]{1,64} (got ${JSON.stringify(s)})`);
  }
  return s;
}

export function assertKind(s: unknown, label: string): string {
  if (!isValidKind(s)) {
    throw new Error(`Invalid ${label}: must match [a-z][a-z0-9:-]{0,63} (got ${JSON.stringify(s)})`);
  }
  return s;
}

/**
 * EntityId 形式 (kebab-case) を strict に強制する assert (RFC #1284)。
 *
 * 用途: write 関数の data 内部 (`root.id` or `meta.id`) で旧 UUID 形式の埋め込みを拒否し、
 * 新形式 (EntityId) に統一する。handler 入口は `assertEntityIdOrUuid` を使う。
 */
export function assertEntityId(s: unknown, label: string): string {
  if (!isValidEntityId(s)) {
    throw new Error(
      `Invalid ${label}: must be kebab-case EntityId matching ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ with length 1..64 (got ${JSON.stringify(s)})`,
    );
  }
  return s;
}

/**
 * EntityId | UUID v4 のどちらかを accept する assert (RFC #1284 移行期間 compat)。
 *
 * 用途: handler / wsHandler 入口 (MCP tool args / WS RPC params)。
 * I-3 完了前の examples (UUID 形式) と、I-2 以降に新規生成される data (EntityId) の両方を受ける。
 */
export function assertEntityIdOrUuid(s: unknown, label: string): string {
  if (!isValidEntityIdOrUuid(s)) {
    throw new Error(
      `Invalid ${label}: must be kebab-case EntityId or UUID v4 (got ${JSON.stringify(s)})`,
    );
  }
  return s;
}

// ── historyId validator ───────────────────────────────────────────────────────

/**
 * historyId の型ガード。
 * 形式: "<ISO-timestamp-safe>--<sessionId-prefix>-<rand>"
 * 許容文字: [0-9A-Za-z._:-]{1,128}
 * "/" "\" ".." は含まない (path traversal 不可)。
 */
export function isValidHistoryId(s: unknown): s is string {
  if (typeof s !== "string") return false;
  // path separator および ".." を明示拒否 (regex の前に高速フィルタ)
  if (s.includes("/") || s.includes("\\") || s.includes("..")) return false;
  return HISTORY_ID_RE.test(s);
}

export function assertHistoryId(s: unknown, label: string): string {
  if (!isValidHistoryId(s)) {
    throw new Error(
      `Invalid ${label}: must match [0-9A-Za-z._:-]{1,128} without path separators or ".." (got ${JSON.stringify(s)})`,
    );
  }
  return s;
}

/**
 * target が root ディレクトリ配下に収まっているか検証する (path traversal 対策)。
 * OK なら resolved 絶対パスを返す。NG なら Error を throw。
 */
export function assertPathContained(target: string, root: string): string {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(`Path traversal detected: ${target} escapes ${root}`);
  }
  return resolvedTarget;
}
