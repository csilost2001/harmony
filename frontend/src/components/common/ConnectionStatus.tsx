/**
 * backend との接続状態。いったん接続できたあとに切れたら、ヘッダーに知らせる。
 * 切れている間の保存・読み込みは失敗するため、黙っていると「保存したつもり」になる。
 * 最初の接続の失敗は AppShell の接続エラー画面が受け持つので、ここでは出さない。
 */
import { useEffect, useRef, useState } from "react";
import { mcpBridge, type McpStatus } from "../../mcp/mcpBridge";
import { useErrorDialog } from "./ErrorDialogProvider";
import { isConnectionError } from "../../utils/connectionError";
import "../../styles/connectionStatus.css";

/** 同じ知らせを続けて出さない間隔 */
const NOTIFY_INTERVAL_MS = 15_000;

/** 切断の表示を出すまでの猶予 (一瞬の切断・再接続では出さない) */
const SHOW_DELAY_MS = 1500;
/** 復旧のお知らせを出す時間 */
const RESTORED_MS = 3000;

export function ConnectionStatus() {
  const { showError } = useErrorDialog();
  const lastNotified = useRef(0);

  // 保存などの操作がサーバに届かず失敗したとき、黙って何も起きない状態にしない
  useEffect(() => {
    const onRejection = (ev: PromiseRejectionEvent) => {
      if (!isConnectionError(ev.reason)) return;
      const now = Date.now();
      if (now - lastNotified.current < NOTIFY_INTERVAL_MS) return;
      lastNotified.current = now;
      showError({
        title: "サーバに接続できないため、操作できませんでした",
        message: "接続が戻るまで、保存・読み込みなどはできません。編集中の内容はこの画面に残っています。接続が復旧したら、もう一度操作してください。",
        error: ev.reason,
        logSource: "unhandledrejection",
        skipLogRecord: true,
      });
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [showError]);

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
