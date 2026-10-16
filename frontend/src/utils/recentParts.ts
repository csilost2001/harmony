/**
 * 部品パレットの「最近使った部品」(UI 改善提案 続編 第 8 弾 #144)。置いた部品 (種類・独自部品) の、新しい順の記録。ブラウザに、ワークスペースごとに覚える。
 * 値は "node:<種類>" / "component:<独自部品の id>"。
 */
const MAX = 6;
const key = (wsId: string | undefined) => `harmony-recent-parts:${wsId ?? "default"}`;

export function loadRecentParts(wsId: string | undefined): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(wsId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch { return []; }
}

/** 記録に足す (すでにあれば先頭へ)。新しい記録を返す */
export function rememberPart(wsId: string | undefined, part: string): string[] {
  const next = [part, ...loadRecentParts(wsId).filter((p) => p !== part)].slice(0, MAX);
  try { localStorage.setItem(key(wsId), JSON.stringify(next)); } catch { /* 保存できなくても、この画面の中では効く */ }
  return next;
}

export const nodePart = (type: string) => `node:${type}`;
export const componentPart = (id: string) => `component:${id}`;
