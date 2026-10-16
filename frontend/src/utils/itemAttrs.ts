/**
 * 画面項目の「属性だけをコピーして、別の項目へ貼る」(UI 改善提案 第 3 弾 #54)。画面に依存しない純関数と、アプリ内の入れ物。
 * 項目の ID・表示名・紐づけ・イベントは写さない。写せるのは、ここに挙げた入力の決まり・表示の決まりだけ。
 */
import { useSyncExternalStore } from "react";
import type { ScreenItem } from "../types/v3/screen-item";

export const ITEM_ATTRS = [
  { key: "type", label: "型", optIn: true },
  { key: "direction", label: "入出力" },
  { key: "required", label: "必須" },
  { key: "readonly", label: "読み取り専用" },
  { key: "nonVisual", label: "画面に表示しない" },
  { key: "minLength", label: "最小桁" },
  { key: "maxLength", label: "最大桁" },
  { key: "min", label: "最小値" },
  { key: "max", label: "最大値" },
  { key: "step", label: "刻み" },
  { key: "pattern", label: "入力書式 (パターン)" },
  { key: "options", label: "選択肢" },
  { key: "defaultValue", label: "既定値" },
  { key: "placeholder", label: "入力例" },
  { key: "helperText", label: "補足文" },
  { key: "displayFormat", label: "表示書式" },
  { key: "visibleWhen", label: "表示条件" },
  { key: "enabledWhen", label: "活性条件" },
  { key: "errorMessages", label: "エラーメッセージ" },
] as const satisfies ReadonlyArray<{ key: keyof ScreenItem; label: string; optIn?: boolean }>;

export type AttrKey = typeof ITEM_ATTRS[number]["key"];
/** 設定されている属性だけ (未設定の属性は、キーごと無い) */
export type AttrSnapshot = Partial<Record<AttrKey, unknown>>;

export interface AttrClipboard { snapshot: AttrSnapshot; sourceId: string; sourceLabel: string }

/** 項目から、写せる属性を取り出す (設定されているものだけ。値は複製して持つ) */
export function captureAttrs(item: ScreenItem): AttrSnapshot {
  const out: AttrSnapshot = {};
  for (const { key } of ITEM_ATTRS) {
    const v = (item as unknown as Record<string, unknown>)[key];
    if (v !== undefined && v !== null && v !== "") out[key] = structuredClone(v);
  }
  return out;
}

/** 貼るときに、最初から印を付けておく属性 (元の項目が設定しているもの。「型」は、自分で選んだときだけ) */
export function defaultPasteKeys(snapshot: AttrSnapshot): AttrKey[] {
  return ITEM_ATTRS.filter((a) => !("optIn" in a && a.optIn) && snapshot[a.key] !== undefined).map((a) => a.key);
}

/** keys の属性を貼る。元の項目で設定されていた属性はその値に、設定されていなかった属性は、貼り先でも「未設定」に戻す */
export function applyAttrs(item: ScreenItem, snapshot: AttrSnapshot, keys: readonly AttrKey[]): ScreenItem {
  const next = { ...item } as unknown as Record<string, unknown>;
  for (const key of keys) {
    const v = snapshot[key];
    if (v === undefined) delete next[key]; else next[key] = structuredClone(v);
  }
  return next as unknown as ScreenItem;
}

const DIRECTION_LABEL: Record<string, string> = { in: "入力", out: "表示", both: "入力・表示" };

/** 属性の値を、一覧で見せる短い文にする */
export function describeAttr(key: AttrKey, v: unknown): string {
  if (v === undefined) return "未設定";
  if (typeof v === "boolean") return v ? "する" : "しない";
  if (key === "direction") return DIRECTION_LABEL[String(v)] ?? String(v);
  if (key === "options") return `${(v as unknown[]).length} 件`;
  if (key === "errorMessages") return `${Object.keys(v as object).length} 件`;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 28 ? `${s.slice(0, 28)}…` : s;
}

// ── アプリ内の入れ物 (画面を替えても残る) ─────────────────────────────────────
let current: AttrClipboard | null = null;
const listeners = new Set<() => void>();
export const getAttrClipboard = (): AttrClipboard | null => current;
export function setAttrClipboard(c: AttrClipboard | null): void {
  current = c;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useAttrClipboard = (): AttrClipboard | null => useSyncExternalStore(subscribe, getAttrClipboard, getAttrClipboard);
