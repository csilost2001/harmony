/**
 * screen-item Ref フィールド resolver (#734)
 *
 * `*Ref` フィールド (`minLengthRef` / `maxLengthRef` / `minRef` / `maxRef`) を
 * Conventions catalog の `limit.<key>.value` (number) に解決し、
 * 対応する plain フィールド (`minLength` / `maxLength` / `min` / `max`) に展開した
 * ScreenItem を返す純粋関数。
 *
 * - plain フィールドが既にある場合は plain 優先 (Ref は無視)。
 * - conventions が null の場合は shallow copy のみ返す。
 * - 未登録 Ref・regex 非一致 Ref の場合は対応フィールドを埋めない (undefined のまま)。
 *   参照存在の検査は conventionsValidator.checkScreenItemConventionReferences が担当。
 */

import type { ScreenItem } from "../types/v3/screen-item";
import type { Conventions } from "../types/v3/conventions";

/** `@conv.limit.<key>` 形式にマッチする正規表現 */
const LIMIT_REF_RE = /^@conv\.limit\.([a-zA-Z_][\w-]*(?:\.[a-zA-Z_][\w-]*)*)$/;

/**
 * `@conv.limit.<key>` 参照文字列から catalog 値 (number) を解決する。
 * - ref が undefined/空 → undefined
 * - conventions が null → undefined
 * - regex 非一致 → undefined
 * - catalog に key が無い → undefined
 * - value が number でない → undefined
 */
function resolveLimitRef(ref: string | undefined, conventions: Conventions | null): number | undefined {
  if (!ref || !conventions) return undefined;
  const m = LIMIT_REF_RE.exec(ref);
  if (!m) return undefined;
  const entry = conventions.limit?.[m[1]];
  return typeof entry?.value === "number" ? entry.value : undefined;
}

/**
 * ScreenItem 1 件の `*Ref` フィールドを解決して展開した新 ScreenItem を返す。
 * 元オブジェクトは変更しない (shallow copy)。
 */
export function resolveScreenItemRefs(item: ScreenItem, conventions: Conventions | null): ScreenItem {
  const resolved: ScreenItem = { ...item };

  if (resolved.minLength === undefined) {
    const v = resolveLimitRef(item.minLengthRef, conventions);
    if (v !== undefined) resolved.minLength = v;
  }
  if (resolved.maxLength === undefined) {
    const v = resolveLimitRef(item.maxLengthRef, conventions);
    if (v !== undefined) resolved.maxLength = v;
  }
  if (resolved.min === undefined) {
    const v = resolveLimitRef(item.minRef, conventions);
    if (v !== undefined) resolved.min = v;
  }
  if (resolved.max === undefined) {
    const v = resolveLimitRef(item.maxRef, conventions);
    if (v !== undefined) resolved.max = v;
  }

  return resolved;
}
