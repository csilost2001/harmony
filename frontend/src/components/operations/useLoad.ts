/** 連携と運用の画面の、読み込みの共通部品: 最初に読み、書き込みの通知 (opsChanged) と接続のたびに読み直す */
import { useCallback, useEffect, useRef, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

export function useLoad<T>(load: () => Promise<T>, watch: boolean = true, enabled: boolean = true): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    loadRef.current()
      .then((d) => { if (mine === seq.current) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (mine === seq.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    mcpBridge.startWithoutEditor();
    const first = setTimeout(reload, 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 300); };
    const unsubs = watch ? [mcpBridge.onBroadcast("opsChanged", later)] : [];
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") later(); });
    return () => { clearTimeout(first); clearTimeout(timer); unsubs.forEach((u) => u()); unsubStatus(); };
  }, [reload, watch, enabled]);

  return { data, error, loading, reload };
}
