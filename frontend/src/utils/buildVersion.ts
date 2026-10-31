/**
 * 画面の版とサーバの版の食い違い検知 (#1572)。
 * 配布 image を新しい版に差し替えても、開きっぱなしのタブは古い画面のまま新しいサーバにつながる。
 * 画面の版 (vite build が埋め込む ID) と、サーバが接続のたびに知らせる版 (`registered` の buildId) を比べ、
 * 両方あって違うときだけ「古い画面」とする。dev / 単体テスト (画面の ID なし) や、サーバが版を持たない (静的配信なし)
 * ときは比べない。
 */
import { useSyncExternalStore } from "react";

/** vite build が埋め込む、この画面の版の識別子 (frontend/vite.config.ts)。dev / 単体テストでは未定義 */
declare const __HARMONY_BUILD_ID__: string | undefined;

/** この画面の版。build したものだけが持つ。dev / 単体テストでは null */
export function clientBuildId(): string | null {
  return typeof __HARMONY_BUILD_ID__ === "string" && __HARMONY_BUILD_ID__ !== "" ? __HARMONY_BUILD_ID__ : null;
}

let stale = false;
const listeners = new Set<() => void>();

/** サーバが知らせた版を受け取る。画面の版と両方あって違うときだけ、古い画面とする */
export function handleServerBuildId(serverId: unknown): void {
  const mine = clientBuildId();
  const next = mine !== null && typeof serverId === "string" && serverId !== "" && serverId !== mine;
  if (next === stale) return;
  stale = next;
  listeners.forEach((l) => l());
}

export function isStaleBuild(): boolean {
  return stale;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useStaleBuild(): boolean {
  return useSyncExternalStore(subscribe, isStaleBuild, isStaleBuild);
}

export function __resetStaleBuildForTest(): void {
  stale = false;
}
