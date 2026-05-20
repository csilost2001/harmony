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
