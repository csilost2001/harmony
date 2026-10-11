/**
 * 利用者の名前 (ブラウザごとに 1 つ)。編集セッションの参加者の表示名になり、他の人から「<名前> が編集中」と見える。
 * 未設定なら「ゲスト」(participantLabel が、セッション ID の先頭 4 文字を添えて区別する)。
 * 保存先はこのブラウザの localStorage だけ (サーバには、編集セッションを作る・参加するときの表示名として送る)。
 */
import { useSyncExternalStore } from "react";

const KEY = "harmony.userName";
const MAX = 40;
const listeners = new Set<() => void>();

/** 前後の空白・制御文字を除き、40 文字までにする。AI の印 (末尾の @AI) は名乗れない */
export function sanitizeUserName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.replace(/@ai$/i, "").trim().slice(0, MAX);
}

export function getUserName(): string {
  try { return sanitizeUserName(localStorage.getItem(KEY) ?? ""); } catch { return ""; }
}

export function setUserName(name: string): string {
  const clean = sanitizeUserName(name);
  try {
    if (clean) localStorage.setItem(KEY, clean); else localStorage.removeItem(KEY);
  } catch { /* storage 不可: この画面を開いているあいだだけ効かない */ }
  listeners.forEach((l) => l());
  return clean;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => { listeners.delete(l); window.removeEventListener("storage", l); };
}

export function useUserName(): string {
  return useSyncExternalStore(subscribe, getUserName, () => "");
}

export const USER_NAME_MAX = MAX;
