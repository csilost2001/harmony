/**
 * 試作 (サンドボックス) (UI 改善提案 続編 第 9 弾 #178)。設計の内容を、名前をつけて「試作」としてブラウザに残す。
 * 本体 (原本) には書かない。気に入った試作は、編集中の画面へ読み込んで (保存するまで原本は変わらない)、変更点を確かめてから保存する。
 * 編集中の下書きがあればその内容、なければ保存済みの内容を、試作にする。1 つの設計に 5 件まで、1 件 400 KB まで。ワークスペースごと。
 */
export interface Trial { id: string; name: string; at: string; snapshot: unknown }
export type TrialMap = Record<string, Trial[]>;

export const MAX_TRIALS_PER_DESIGN = 5;
export const MAX_TRIAL_BYTES = 400 * 1024;
export const trialsKey = (wsId: string | undefined) => `harmony-trials:${wsId ?? "default"}`;
export const trialRef = (kind: string, id: string) => `${kind}:${id}`;

export function loadTrials(wsId: string | undefined): TrialMap {
  try {
    const raw = JSON.parse(localStorage.getItem(trialsKey(wsId)) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: TrialMap = {};
    for (const [ref, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const ok = list.filter((t): t is Trial => !!t && typeof t === "object" && typeof (t as Trial).id === "string" && typeof (t as Trial).name === "string" && "snapshot" in (t as object));
      if (ok.length) out[ref] = ok.slice(0, MAX_TRIALS_PER_DESIGN);
    }
    return out;
  } catch { return {}; }
}

export type AddTrialResult = { ok: true; trials: TrialMap; trial: Trial } | { ok: false; reason: "name" | "limit" | "size" | "storage"; trials: TrialMap };

/** 試作を足す。名前が空・件数の上限・大きさの上限・ブラウザの保存領域の不足は、足さずに理由を返す */
export function addTrial(wsId: string | undefined, ref: string, name: string, snapshot: unknown, now: Date = new Date(), newId: () => string = () => `t${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`): AddTrialResult {
  const trials = loadTrials(wsId);
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return { ok: false, reason: "name", trials };
  const list = trials[ref] ?? [];
  if (list.length >= MAX_TRIALS_PER_DESIGN) return { ok: false, reason: "limit", trials };
  let size = 0;
  try { size = JSON.stringify(snapshot).length; } catch { return { ok: false, reason: "size", trials }; }
  if (size > MAX_TRIAL_BYTES) return { ok: false, reason: "size", trials };
  const trial: Trial = { id: newId(), name: trimmed, at: now.toISOString(), snapshot: structuredClone(snapshot) };
  const next = { ...trials, [ref]: [trial, ...list] };
  try { localStorage.setItem(trialsKey(wsId), JSON.stringify(next)); } catch { return { ok: false, reason: "storage", trials }; }
  return { ok: true, trials: next, trial };
}

export function removeTrial(wsId: string | undefined, ref: string, id: string): TrialMap {
  const trials = loadTrials(wsId);
  const rest = (trials[ref] ?? []).filter((t) => t.id !== id);
  const next = { ...trials };
  if (rest.length) next[ref] = rest; else delete next[ref];
  try { localStorage.setItem(trialsKey(wsId), JSON.stringify(next)); } catch { /* 無視 */ }
  return next;
}

export const TRIAL_REASON_TEXT: Record<Exclude<AddTrialResult, { ok: true }>["reason"], string> = {
  name: "試作の名前を入れてください",
  limit: `試作は 1 つの設計に ${MAX_TRIALS_PER_DESIGN} 件までです。要らないものを消してください`,
  size: "内容が大きすぎて、試作にできません (400 KB まで)",
  storage: "ブラウザの保存領域がいっぱいで、試作を残せませんでした",
};
