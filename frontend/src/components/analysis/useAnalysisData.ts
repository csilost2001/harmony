/**
 * 設計の分析の画面が使うデータ: 設計書の入力 (loadDesignInput) と、点検の設定 (抑制・独自ルール)。
 * 設計や設定が変わったら (保存・ほかの人の変更・外部のファイルの変更の通知)、まとめて読み直す。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckSettings, DesignDocInput } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadDesignInput } from "../document/loadDesignInput";

const RELOAD_EVENTS = [
  "projectChanged", "screenChanged", "screenItemsChanged", "processFlowChanged", "tableChanged", "businessFlowChanged", "reportChanged",
  "layoutComponentsChanged", "genericDefinitionChanged", "designCheckChanged",
] as const;

export interface AnalysisData {
  input: DesignDocInput | null;
  skipped: string[];
  settings: CheckSettings | null;
  /** 設定ファイルの読めなかった項目 (手で書き換えた誤り) */
  settingsProblems: string[];
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useAnalysisData(): AnalysisData {
  const [input, setInput] = useState<DesignDocInput | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [settings, setSettings] = useState<CheckSettings | null>(null);
  const [settingsProblems, setSettingsProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    Promise.all([loadDesignInput(), mcpBridge.request("designCheck.load") as Promise<{ settings: CheckSettings; problems: string[] }>])
      .then(([d, s]) => {
        if (mine !== seq.current) return; // 古い読み込みの結果は捨てる
        setInput(d.input); setSkipped(d.skipped); setSettings(s.settings); setSettingsProblems(s.problems ?? []); setError(null);
      })
      .catch((e: unknown) => { if (mine === seq.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, []);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    // 最初の読み込みは、描画のあとに始める (効果の中で、状態を同期的に更新しない)
    const first = setTimeout(reload, 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 保存が続けて起きても、読み直しは 1 回にまとめる
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 400); };
    const unsubs = RELOAD_EVENTS.map((ev) => mcpBridge.onBroadcast(ev, later));
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") later(); });
    return () => { clearTimeout(first); clearTimeout(timer); unsubs.forEach((u) => u()); unsubStatus(); };
  }, [reload]);

  return { input, skipped, settings, settingsProblems, error, loading, reload };
}
