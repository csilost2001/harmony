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
 *   - AND NOT UUID v? 形式 (RFC 4122 UUID は a-f 始まりが本 regex に偶然合致するため明示除外)
 *
 * 用途: Screen / Table / ProcessFlow / Sequence / View / ViewDefinition / PageLayout の
 * top-level entity id (ファイル名 / URL / @参照 / JSON ref 値)。
 * step/edge/column 等の intra-entity local id (LocalId) は本 validator の対象外。
 *
 * I-7 Round 2 (#1299 Codex review M-1): `f81dd9e0-794c-4539-...` のように先頭が a-f の
 * UUID v4 文字列は ENTITY_ID_RE に偶然合致するため、UUID_RE で明示的に除外する。
 * これにより compat shim 撤廃 (Phase A) の意図が保たれ、`assertEntityId` 経由の handler は
 * 旧 UUID 形式の id を一切受け付けなくなる。
 */
export function isValidEntityId(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length <= ENTITY_ID_MAX_LENGTH &&
    ENTITY_ID_RE.test(s) &&
    !UUID_RE.test(s)
  );
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
 * 用途: handler / wsHandler 入口 (MCP tool args / WS RPC params) および
 * write 関数の data 内部 (`root.id` or `meta.id`) の id 検証。
 *
 * I-7 (#1299) で I-2 由来の `assertEntityIdOrUuid` compat shim を撤廃し、
 * EntityId (kebab-case) のみを受ける strict モードに統一した。
 */
export function assertEntityId(s: unknown, label: string): string {
  if (!isValidEntityId(s)) {
    throw new Error(
      `Invalid ${label}: must be kebab-case EntityId matching ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ with length 1..64 (got ${JSON.stringify(s)})`,
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
