/**
 * backend との接続状態。いったん接続できたあとに切れたら、ヘッダーに知らせる。
 * 切れている間の保存・読み込みは失敗するため、黙っていると「保存したつもり」になる。
 * 最初の接続の失敗は AppShell の接続エラー画面が受け持つので、ここでは出さない。
 */
import { useEffect, useState } from "react";
import { mcpBridge, type McpStatus } from "../../mcp/mcpBridge";
import "../../styles/connectionStatus.css";

/** 切断の表示を出すまでの猶予 (一瞬の切断・再接続では出さない) */
const SHOW_DELAY_MS = 1500;
/** 復旧のお知らせを出す時間 */
const RESTORED_MS = 3000;

export function ConnectionStatus() {
  const [phase, setPhase] = useState<"ok" | "lost" | "restored">("ok");

  useEffect(() => {
    let everConnected = mcpBridge.getStatus() === "connected";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lost = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = undefined; } };
    const off = mcpBridge.onStatusChange((s: McpStatus) => {
      if (s === "connected") {
        everConnected = true;
        clear();
        if (lost) {
          lost = false;
          setPhase("restored");
          timer = setTimeout(() => setPhase("ok"), RESTORED_MS);
        }
        return;
      }
      // 接続を試みている間 (connecting) も切れたまま。猶予のあとで 1 回だけ知らせる
      if (everConnected && !lost && !timer) {
        timer = setTimeout(() => { timer = undefined; lost = true; setPhase("lost"); }, SHOW_DELAY_MS);
      }
    });
    return () => { off(); clear(); };
  }, []);

  const show = phase !== "ok";
  const restored = phase === "restored";
  if (!show) return null;
  return restored ? (
    <span className="connection-status connection-status--restored" role="status" data-testid="connection-status">
      <i className="bi bi-check-circle-fill" /> 接続が復旧しました
    </span>
  ) : (
    <span className="connection-status connection-status--lost" role="alert" data-testid="connection-status"
      title="backend サーバとの接続が切れています。保存・読み込みはできません。自動で再接続します。">
      <i className="bi bi-plug-fill" /> サーバとの接続が切れています — 再接続しています
    </span>
  );
}
