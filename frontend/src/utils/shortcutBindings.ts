/**
 * ショートカットのキーの割り当て (UI 改善提案 続編 第 10 弾 #188)。変更できるショートカットの台帳 (既定のキー) と、このブラウザでの変更。
 * 変更は localStorage (`harmony.shortcuts`) に覚え、設定の書き出し・読み込みで持ち出せる。変更できるのは、台帳にある「どこでも使う」ショートカットだけ
 * (保存 Ctrl+S・元に戻す・一覧のキーなど、編集の基本のキーは固定)。衝突 (台帳の別のキー・固定のキー・ブラウザが使うキー) は、断る。
 */
import { useSyncExternalStore } from "react";

export interface BindableShortcut { id: string; label: string; default: string }

export const BINDABLE_SHORTCUTS: BindableShortcut[] = [
  { id: "lastEdit", label: "最後に編集した場所へ戻る", default: "Ctrl+Alt+Backspace" },
  { id: "copyLink", label: "選んでいる要素へのリンクをコピー", default: "Ctrl+Alt+L" },
  { id: "focusMode", label: "入力専用モードの切り替え", default: "Ctrl+Alt+F" },
  { id: "replace", label: "設計全体の検索置換", default: "Ctrl+Shift+H" },
  { id: "clipboardHistory", label: "コピーの履歴から選び直す", default: "Ctrl+Shift+V" },
  { id: "addMarker", label: "AI への指示・質問 (マーカー) を追加", default: "Ctrl+Alt+M" },
];

/** 変更できないキー (編集の基本・一覧の操作・タブ・コマンドパレット・ブラウザが先に使うもの)。割り当てに使えない */
export const RESERVED_COMBOS: ReadonlySet<string> = new Set([
  "Ctrl+S", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Ctrl+F", "Ctrl+A", "Ctrl+C", "Ctrl+X", "Ctrl+V", "Ctrl+D", "Ctrl+W", "Ctrl+T", "Ctrl+N", "Ctrl+R", "Ctrl+P", "Ctrl+L", "Ctrl+O",
  "Ctrl+K", "Ctrl+Shift+P", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+Alt+T", "Ctrl+Shift+T", "Ctrl+Alt+Left", "Ctrl+Alt+Right", "Ctrl+Shift+PageUp", "Ctrl+Shift+PageDown",
  "Alt+F4", "F5", "F11", "F12", "Ctrl+Shift+I", "Ctrl+Shift+N",
]);

const MODS = ["Ctrl", "Alt", "Shift"] as const;
const KEY_ALIASES: Record<string, string> = { " ": "Space", Esc: "Escape", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Del: "Delete" };

/** 組み合わせを、正規の形 (Ctrl+Alt+Shift+キー。キーは大文字 1 文字か、名前) にそろえる。読めなければ null */
export function normalizeCombo(raw: string): string | null {
  const parts = raw.split("+").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => (m.toLowerCase() === "cmd" || m.toLowerCase() === "meta" || m.toLowerCase() === "control" ? "Ctrl" : m.charAt(0).toUpperCase() + m.slice(1).toLowerCase())));
  if ([...mods].some((m) => !(MODS as readonly string[]).includes(m))) return null;
  const k = KEY_ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
  if (["Ctrl", "Alt", "Shift", "Control", "Meta"].includes(k)) return null; // 修飾キーだけは、割り当てにならない
  return [...MODS.filter((m) => mods.has(m)), k].join("+");
}

/** キーボードのイベントを、正規の組み合わせにする (修飾キーだけのイベントは null) */
export function comboOfEvent(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const mods = [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : ""].filter(Boolean);
  const k = KEY_ALIASES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [...mods, k].join("+");
}

export type ValidateResult = { ok: true; combo: string } | { ok: false; error: string };

/** キーの組み合わせとして使えるか (衝突は見ない): 修飾キーを含む (ファンクションキーは単独でも可)・Shift だけでない・固定のキーでない。使えなければ、その理由 */
function comboProblem(combo: string): string | null {
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const isFn = /^F([1-9]|1[0-2])$/.test(key);
  if (parts.length === 1 && !isFn) return "Ctrl・Alt・Shift のどれかと組み合わせてください (ファンクションキーは単独でも使えます)";
  if (parts.length > 1 && !parts.slice(0, -1).some((m) => m === "Ctrl" || m === "Alt") && !isFn) return "Shift だけとの組み合わせは、入力と重なるため使えません (Ctrl か Alt を含めてください)";
  if (RESERVED_COMBOS.has(combo)) return `${combo} は、固定のキー (編集の基本・タブ・ブラウザ) と重なるため使えません`;
  return null;
}

/** 割り当てられるか: キーとして使え、ほかの割り当てと重ならない */
export function validateBinding(id: string, raw: string, current: Readonly<Record<string, string>> = effectiveAll()): ValidateResult {
  const combo = normalizeCombo(raw);
  if (!combo) return { ok: false, error: "キーの組み合わせとして読めません" };
  const problem = comboProblem(combo);
  if (problem) return { ok: false, error: problem };
  for (const b of BINDABLE_SHORTCUTS) {
    if (b.id !== id && current[b.id] === combo) return { ok: false, error: `${combo} は、「${b.label}」に割り当て済みです` };
  }
  return { ok: true, combo };
}

// ── 保存と購読 ─────────────────────────────────────────────
const KEY = "harmony.shortcuts";
const listeners = new Set<() => void>();
let overrides: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (overrides) return overrides;
  const out: Record<string, string> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const b of BINDABLE_SHORTCUTS) {
        const v = (raw as Record<string, unknown>)[b.id];
        const c = typeof v === "string" ? normalizeCombo(v) : null;
        // 保存の中身も確かめる (手で書き換えた使えないキー・ほかと重なるキーは捨てる)
        if (c && c !== b.default && !comboProblem(c) && !Object.values(out).includes(c)) out[b.id] = c;
      }
    }
  } catch { /* 壊れていたら、既定 */ }
  overrides = out;
  return out;
}

export const defaultCombo = (id: string): string => BINDABLE_SHORTCUTS.find((b) => b.id === id)?.default ?? "";
/** いまのキー (変更があればそれ、なければ既定) */
export const effectiveCombo = (id: string): string => load()[id] ?? defaultCombo(id);
export function effectiveAll(): Record<string, string> { return Object.fromEntries(BINDABLE_SHORTCUTS.map((b) => [b.id, effectiveCombo(b.id)])); }

function persist(): void {
  try { if (Object.keys(load()).length === 0) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* 保存できなくても、この画面の中では効く */ }
  listeners.forEach((l) => l());
}

/** 割り当てる。使えないキーは、理由を返して変えない */
export function setBinding(id: string, raw: string): ValidateResult {
  const r = validateBinding(id, raw);
  if (!r.ok) return r;
  const next = { ...load() };
  if (r.combo === defaultCombo(id)) delete next[id]; else next[id] = r.combo;
  overrides = next;
  persist();
  return r;
}

export function resetBinding(id?: string): void {
  if (id) { const next = { ...load() }; delete next[id]; overrides = next; } else overrides = {};
  persist();
}

/** キーのイベントが、その割り当てか */
export function matchesBinding(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, id: string): boolean {
  return comboOfEvent(e) === effectiveCombo(id);
}

/** 表示用: 「Ctrl+Alt+L」→ ["Ctrl", "Alt", "L"] */
export const comboKeys = (combo: string): string[] => combo.split("+");

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
let snap = "";
const getSnap = () => { const s = JSON.stringify(load()); if (s !== snap) snap = s; return snap; };
/** 変更を購読する (割り当てが変わったら、再描画)。戻り値は、変更の印 (中身は effectiveCombo で読む) */
export const useBindingsVersion = (): string => useSyncExternalStore(subscribe, getSnap, getSnap);

/** テスト用 */
export function _resetBindings(): void { overrides = null; snap = ""; listeners.forEach((l) => l()); }
