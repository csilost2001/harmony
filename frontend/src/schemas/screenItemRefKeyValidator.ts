/**
 * 画面項目 refKey × 横断整合の検査 (#651、Phase 4 子 3)。
 *
 * 検査軸:
 * - **画面項目 ⇄ 画面項目** (横方向、論理同一性キーによる整合)
 * - 既存 #631 (screenItemFieldTypeValidator) は **画面項目 ⇄ ProcessFlow inputs** の値レベル整合 (縦方向)
 * - 補完関係であり重複なし
 *
 * 検査観点:
 * 1. UNDECLARED_REF_KEY                    — ScreenItem.refKey が conventions.fieldKeys に未宣言 (typo 検出)
 * 2. INCONSISTENT_TYPE_BY_REF_KEY          — 同一 refKey の ScreenItem 間で type が不整合
 * 3. INCONSISTENT_FORMAT_BY_REF_KEY        — 同一 refKey 間で pattern / displayFormat 不整合 (warning)
 * 4. INCONSISTENT_VALIDATION_BY_REF_KEY    — 同一 refKey 間で min/max/minLength/maxLength 不整合 (warning)
 * 5. INCONSISTENT_HANDLER_FLOW_BY_REF_KEY  — 同一 refKey の events で handlerFlowId が業務的に発散 (warning)
 *                                            初期版は eventId 集合の差分 (片側に存在し他方に存在しないイベント) を検出
 * 6. ORPHAN_FIELD_KEY                      — conventions.fieldKeys 宣言だが画面で参照無し (warning)
 * 7. DECLARED_TYPE_MISMATCH                — conventions.fieldKeys[k].type と ScreenItem.refKey=k の type が不一致 (warning)
 *
 * data 収集:
 * - 第一サイト (occurrences[0]) を基点として残りの occurrence と pair 比較 (#619 と同一パターン)
 *
 * 設計者承認: 案 C ハイブリッド (`ScreenItem.refKey: Identifier?` + `Conventions.fieldKeys: Record<string, FieldKeyEntry>`)。
 * paving 適用業界 (子 3 範囲): finance + logistics。残り 5 業界は後続。
 */

import type { Conventions, FieldKeyEntry } from "../types/v3/conventions";
import type { Screen } from "../types/v3/screen";
import type { ScreenItem, ScreenItemEvent } from "../types/v3/screen-item";
import type { FieldType } from "../types/v3/common";

export type ScreenItemRefKeyIssueCode =
  | "UNDECLARED_REF_KEY"
  | "INCONSISTENT_TYPE_BY_REF_KEY"
  | "INCONSISTENT_FORMAT_BY_REF_KEY"
  | "INCONSISTENT_VALIDATION_BY_REF_KEY"
  | "INCONSISTENT_HANDLER_FLOW_BY_REF_KEY"
  | "ORPHAN_FIELD_KEY"
  | "DECLARED_TYPE_MISMATCH";

export interface ScreenItemRefKeyIssue {
  path: string;
  code: ScreenItemRefKeyIssueCode;
  severity: "error" | "warning";
  refKey: string;
  message: string;
}

interface Occurrence {
  screenId: string;
  itemId: string;
  itemIndex: number;
  item: ScreenItem;
  path: string;
}

function getScreenId(screen: Screen): string | null {
  return (screen.id as string | undefined) ?? null;
}

/**
 * FieldType を比較用の正規化文字列に変換 (kind 部分のみ抽出)。
 * primitive は文字列、object/array/extension/domain 等は kind 名で比較する。
 * extension の場合は extensionRef も含めて strict に一致させる (例: `extension:finance:accountNumber`)。
 */
function normalizeType(type: FieldType | undefined): string | null {
  if (type === undefined) return null;
  if (typeof type === "string") return type;
  if (typeof type === "object" && type !== null) {
    const kind = (type as { kind?: string }).kind;
    if (typeof kind !== "string") return null;
    if (kind === "extension") {
      const ref = (type as { extensionRef?: string }).extensionRef;
      return ref ? `extension:${ref}` : "extension";
    }
    if (kind === "domain") {
      const dk = (type as { domainKey?: string }).domainKey;
      return dk ? `domain:${dk}` : "domain";
    }
    return kind;
  }
  return null;
}

function collectOccurrences(screens: Screen[]): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  screens.forEach((screen, si) => {
    const screenId = getScreenId(screen) ?? `screens[${si}]`;
    const items = screen.items ?? [];
    items.forEach((item: ScreenItem, ii: number) => {
      const refKey = item.refKey;
      if (typeof refKey !== "string" || refKey.length === 0) return;
      const occ: Occurrence = {
        screenId,
        itemId: typeof item.id === "string" ? item.id : String(ii),
        itemIndex: ii,
        item,
        path: `screens[id=${screenId}].items[ii=${ii}=${item.id ?? "?"}]`,
      };
      const list = map.get(refKey);
      if (list) list.push(occ);
      else map.set(refKey, [occ]);
    });
  });
  return map;
}

function eventIdSet(item: ScreenItem): Set<string> {
  const set = new Set<string>();
  for (const ev of item.events ?? []) {
    if (typeof ev.id === "string" && ev.id.length > 0) set.add(ev.id);
  }
  return set;
}

function handlerFlowIdByEvent(item: ScreenItem): Map<string, string> {
  const m = new Map<string, string>();
  for (const ev of item.events ?? []) {
    if (typeof ev.id === "string" && typeof ev.handlerFlowId === "string") {
      m.set(ev.id, ev.handlerFlowId);
    }
  }
  return m;
}

function symmetricDifference<T>(a: Set<T>, b: Set<T>): T[] {
  const result: T[] = [];
  for (const x of a) if (!b.has(x)) result.push(x);
  for (const x of b) if (!a.has(x)) result.push(x);
  return result;
}

function checkUndeclared(
  occurrences: Map<string, Occurrence[]>,
  declared: Map<string, FieldKeyEntry>,
  hasFieldKeysDeclared: boolean,
  issues: ScreenItemRefKeyIssue[],
): void {
  // conventions.fieldKeys が存在しない場合は UNDECLARED_REF_KEY を抑止
  // (catalog 未整備のプロジェクトに過剰指摘しない、draft-state policy 準拠)
  if (!hasFieldKeysDeclared) return;
  for (const [refKey, occs] of occurrences) {
    if (declared.has(refKey)) continue;
    for (const occ of occs) {
      issues.push({
        path: `${occ.path}.refKey`,
        code: "UNDECLARED_REF_KEY",
        severity: "error",
        refKey,
        message: `ScreenItem refKey '${refKey}' is not declared in conventions.fieldKeys (typo 検出)。`,
      });
    }
  }
}

function checkInconsistencies(occurrences: Map<string, Occurrence[]>, issues: ScreenItemRefKeyIssue[]): void {
  for (const [refKey, occs] of occurrences) {
    if (occs.length < 2) continue;
    const base = occs[0];
    const baseType = normalizeType(base.item.type as FieldType | undefined);
    const basePattern = base.item.pattern;
    const baseDisplayFormat = base.item.displayFormat;
    const baseMin = base.item.min;
    const baseMax = base.item.max;
    const baseMinLen = base.item.minLength;
    const baseMaxLen = base.item.maxLength;
    const baseEvents = eventIdSet(base.item);
    const baseHandlers = handlerFlowIdByEvent(base.item);

    for (let i = 1; i < occs.length; i++) {
      const occ = occs[i];

      // INCONSISTENT_TYPE_BY_REF_KEY (error)
      const occType = normalizeType(occ.item.type as FieldType | undefined);
      if (baseType !== null && occType !== null && baseType !== occType) {
        issues.push({
          path: `${occ.path}.type`,
          code: "INCONSISTENT_TYPE_BY_REF_KEY",
          severity: "error",
          refKey,
          message: `ScreenItem refKey '${refKey}' type '${occType}' does not match first occurrence ${base.path} type '${baseType}'.`,
        });
      }

      // INCONSISTENT_FORMAT_BY_REF_KEY (warning) — pattern / displayFormat
      if (basePattern !== undefined && occ.item.pattern !== undefined && basePattern !== occ.item.pattern) {
        issues.push({
          path: `${occ.path}.pattern`,
          code: "INCONSISTENT_FORMAT_BY_REF_KEY",
          severity: "warning",
          refKey,
          message: `ScreenItem refKey '${refKey}' pattern '${occ.item.pattern}' does not match first occurrence ${base.path} pattern '${basePattern}'.`,
        });
      }
      if (
        baseDisplayFormat !== undefined &&
        occ.item.displayFormat !== undefined &&
        baseDisplayFormat !== occ.item.displayFormat
      ) {
        issues.push({
          path: `${occ.path}.displayFormat`,
          code: "INCONSISTENT_FORMAT_BY_REF_KEY",
          severity: "warning",
          refKey,
          message: `ScreenItem refKey '${refKey}' displayFormat '${occ.item.displayFormat}' does not match first occurrence ${base.path} displayFormat '${baseDisplayFormat}'.`,
        });
      }

      // INCONSISTENT_VALIDATION_BY_REF_KEY (warning) — min/max/minLength/maxLength
      const validationDiffs: string[] = [];
      if (baseMin !== undefined && occ.item.min !== undefined && baseMin !== occ.item.min) {
        validationDiffs.push(`min ${occ.item.min} vs ${baseMin}`);
      }
      if (baseMax !== undefined && occ.item.max !== undefined && baseMax !== occ.item.max) {
        validationDiffs.push(`max ${occ.item.max} vs ${baseMax}`);
      }
      if (baseMinLen !== undefined && occ.item.minLength !== undefined && baseMinLen !== occ.item.minLength) {
        validationDiffs.push(`minLength ${occ.item.minLength} vs ${baseMinLen}`);
      }
      if (baseMaxLen !== undefined && occ.item.maxLength !== undefined && baseMaxLen !== occ.item.maxLength) {
        validationDiffs.push(`maxLength ${occ.item.maxLength} vs ${baseMaxLen}`);
      }
      if (validationDiffs.length > 0) {
        issues.push({
          path: `${occ.path}`,
          code: "INCONSISTENT_VALIDATION_BY_REF_KEY",
          severity: "warning",
          refKey,
          message: `ScreenItem refKey '${refKey}' validation differs from first occurrence ${base.path}: ${validationDiffs.join(", ")}. (画面別緩和は許容、可視化のみ)`,
        });
      }

      // INCONSISTENT_HANDLER_FLOW_BY_REF_KEY (warning)
      // 追加メタ要件で誤検出抑止 (採用方針 (m)):
      //   両 ScreenItem が共に events[] を 1 件以上持つ場合のみ判定。
      //   片側に events 無 / 片側のみに events ありは「画面 role の違い (一覧画面 vs 編集画面 等)」として許容。
      const occEvents = eventIdSet(occ.item);
      const occHandlers = handlerFlowIdByEvent(occ.item);
      if (baseEvents.size > 0 && occEvents.size > 0) {
        const eventDiff = symmetricDifference(baseEvents, occEvents);
        const handlerMismatches: string[] = [];
        for (const eid of baseEvents) {
          if (!occEvents.has(eid)) continue;
          const bh = baseHandlers.get(eid);
          const oh = occHandlers.get(eid);
          if (bh !== undefined && oh !== undefined && bh !== oh) {
            handlerMismatches.push(`event '${eid}' handlerFlow ${oh} vs ${bh}`);
          }
        }
        if (eventDiff.length > 0 || handlerMismatches.length > 0) {
          const parts: string[] = [];
          if (eventDiff.length > 0) parts.push(`event id 差分: ${eventDiff.join(", ")}`);
          if (handlerMismatches.length > 0) parts.push(handlerMismatches.join(", "));
          issues.push({
            path: `${occ.path}.events`,
            code: "INCONSISTENT_HANDLER_FLOW_BY_REF_KEY",
            severity: "warning",
            refKey,
            message: `ScreenItem refKey '${refKey}' event handler diverges from first occurrence ${base.path}: ${parts.join("; ")}.`,
          });
        }
      }
    }
  }
}

function checkOrphans(
  occurrences: Map<string, Occurrence[]>,
  declared: Map<string, FieldKeyEntry>,
  issues: ScreenItemRefKeyIssue[],
): void {
  for (const [refKey] of declared) {
    if (occurrences.has(refKey)) continue;
    issues.push({
      path: `conventions.fieldKeys.${refKey}`,
      code: "ORPHAN_FIELD_KEY",
      severity: "warning",
      refKey,
      message: `conventions.fieldKeys.${refKey} is declared but not referenced by any ScreenItem.refKey (将来削除候補)。`,
    });
  }
}

function checkDeclaredTypeMismatch(
  occurrences: Map<string, Occurrence[]>,
  declared: Map<string, FieldKeyEntry>,
  issues: ScreenItemRefKeyIssue[],
): void {
  for (const [refKey, occs] of occurrences) {
    const entry = declared.get(refKey);
    if (!entry) continue;
    const declaredType = normalizeType(entry.type);
    if (declaredType === null) continue;
    for (const occ of occs) {
      const occType = normalizeType(occ.item.type as FieldType | undefined);
      if (occType === null) continue;
      if (occType !== declaredType) {
        issues.push({
          path: `${occ.path}.type`,
          code: "DECLARED_TYPE_MISMATCH",
          severity: "warning",
          refKey,
          message: `ScreenItem refKey '${refKey}' type '${occType}' does not match conventions.fieldKeys.${refKey}.type '${declaredType}'.`,
        });
      }
    }
  }
}

/**
 * 画面項目 refKey × 横断整合の検証エントリポイント (#651)。
 *
 * @param screens     プロジェクト内の全画面定義
 * @param conventions プロジェクト内の規約カタログ (null 許容、null の場合は ORPHAN / DECLARED_TYPE_MISMATCH 検出が抑止)
 */
export function checkScreenItemRefKeyConsistency(
  screens: Screen[],
  conventions: Conventions | null,
): ScreenItemRefKeyIssue[] {
  const issues: ScreenItemRefKeyIssue[] = [];
  const occurrences = collectOccurrences(screens ?? []);
  const declared = new Map<string, FieldKeyEntry>();
  const hasFieldKeysDeclared =
    conventions !== null && conventions.fieldKeys !== undefined && conventions.fieldKeys !== null;
  if (hasFieldKeysDeclared && conventions?.fieldKeys) {
    for (const [k, v] of Object.entries(conventions.fieldKeys)) {
      if (v && typeof v === "object") declared.set(k, v as FieldKeyEntry);
    }
  }

  checkUndeclared(occurrences, declared, hasFieldKeysDeclared, issues);
  checkInconsistencies(occurrences, issues);
  if (hasFieldKeysDeclared) {
    checkOrphans(occurrences, declared, issues);
    checkDeclaredTypeMismatch(occurrences, declared, issues);
  }

  return issues;
}

// 未使用 import を保持 (将来の拡張観点で events 内訳を見るときに使う):
// — currently used in handlerFlowIdByEvent / eventIdSet
export type { ScreenItemEvent };
