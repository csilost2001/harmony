/**
 * useEditLevel — 処理フローエディタの編集レベル (設計段階) を管理する hook。
 *
 * 編集レベル:
 *   rough          ラフ設計 — step の目的・失敗時・メモのみ表示
 *   detail         詳細設計 — 入出力・DB/画面/外部参照まで表示
 *   implementation プログラム設計 — 全項目表示 (デフォルト)
 *
 * localStorage に永続化 (key=`processFlow:editLevel:<flowId>`)。
 * flowId が undefined の場合は in-memory のみ。
 *
 * S-2 fix (render-time sync): 同じ ProcessFlowEditor インスタンスが React Router で別 flow に
 * 再利用された場合 (タブ切替) でも、編集レベルが旧 flow の localStorage に
 * 書き戻されない (= 設定がにじまない) ことを保証する。
 * React 公式推奨の render-time sync パターン (prevFlowId state 使用) で実装。
 */

import { useCallback, useEffect, useState } from "react";

export type EditLevel = "rough" | "detail" | "implementation";

const VALID_LEVELS = new Set<string>(["rough", "detail", "implementation"]);

function isValidLevel(value: unknown): value is EditLevel {
  return typeof value === "string" && VALID_LEVELS.has(value);
}

function storageKeyFor(flowId: string): string {
  return `processFlow:editLevel:${flowId}`;
}

function readLevel(flowId: string | undefined): EditLevel {
  if (!flowId || typeof window === "undefined") return "implementation";
  try {
    const raw = window.localStorage.getItem(storageKeyFor(flowId));
    if (raw === null) return "implementation";
    const parsed = JSON.parse(raw);
    return isValidLevel(parsed) ? parsed : "implementation";
  } catch {
    return "implementation";
  }
}

function writeLevel(flowId: string, level: EditLevel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyFor(flowId), JSON.stringify(level));
  } catch {
    // quota / privacy mode: 無視
  }
}

/**
 * 新しく作った処理フローの、最初の深さを決める (ISSUE #1528 f)。まだ覚えている深さが無いときだけ書く。
 * 作ったばかりのフローは、「詳細」(テーブル・操作・遷移先などを選べる。「実装」との差は、詳細メタ情報の欄だけ) から始める。
 * 「ラフ」(概要だけ) だと、テーブルや遷移先を選ぶ欄まで隠れて、案内どおりに進めないので、始めには使わない。あとから、深さの切り替えで変えられる。
 */
export function presetEditLevel(flowId: string, level: EditLevel): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(storageKeyFor(flowId)) === null) writeLevel(flowId, level);
  } catch { /* 読めなければ、既定のまま */ }
}

export interface UseEditLevelResult {
  editLevel: EditLevel;
  setEditLevel: (level: EditLevel) => void;
}

/**
 * 編集レベルを管理する hook。
 * @param flowId 処理フロー ID (localStorage キーの suffix)。未指定時は in-memory のみ
 *
 * flowId が変化した場合 (タブ切替で同インスタンスが別 flow を扱うようになった場合) は、
 * React 公式推奨の render-time sync パターンで新しい flowId の永続値を即座に同期する。
 * prevFlowId state を利用することで、旧 flowId の localStorage には書き戻されない。
 */
export function useEditLevel(flowId?: string): UseEditLevelResult {
  const [prevFlowId, setPrevFlowId] = useState<string | undefined>(flowId);
  const [editLevel, setEditLevelState] = useState<EditLevel>(() => readLevel(flowId));

  // render-time sync: flowId が変化したら即座に state を同期 (useEffect より前に処理)
  if (flowId !== prevFlowId) {
    setPrevFlowId(flowId);
    setEditLevelState(readLevel(flowId));
  }

  // state 変更時のみ現在の flowId に書き戻す。
  // prevFlowId !== flowId の中間状態では書き戻しを抑止し、旧 flowId への設定にじみを防ぐ。
  useEffect(() => {
    if (!flowId) return;
    if (prevFlowId !== flowId) return; // 同期前の中間状態は永続化しない
    writeLevel(flowId, editLevel);
  }, [flowId, editLevel, prevFlowId]);

  const setEditLevel = useCallback((level: EditLevel) => {
    setEditLevelState(level);
  }, []);

  return { editLevel, setEditLevel };
}
