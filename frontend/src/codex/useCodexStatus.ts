/**
 * useCodexStatus — Codex 接続/認証状態を取得・購読する hook。
 *
 * 状態種別:
 *   checking          初回フェッチ中
 *   no-cli            spawn ENOENT 系。`codex` CLI が PATH に無い
 *   no-server         transport closed / ECONNREFUSED 系
 *   unauthenticated   接続成功・未ログイン
 *   authenticated     接続成功・ログイン済
 *   error             その他のエラー
 *
 * `account/login/completed` notification を購読し、login 完了で自動 refresh。
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { CodexBrowserClient } from "./codexClient";
import { codexClient as defaultClient } from "./codexClient";
import type { AccountState, CodexAccount, CodexNotification } from "./types";

export type CodexStatus =
  | { kind: "checking" }
  | { kind: "no-cli"; error: string }
  | { kind: "no-server"; error: string }
  | { kind: "unauthenticated"; requiresOpenaiAuth: boolean }
  | { kind: "authenticated"; account: CodexAccount }
  | { kind: "error"; error: string };

export type CodexErrorKind = "no-cli" | "no-server" | "error";

/**
 * エラーメッセージを大別する。
 * - spawn ENOENT / "command not found" / "spawn ... codex" 系 → no-cli
 * - transport closed / ECONNREFUSED / WebSocket close 系 → no-server
 * - それ以外 → error
 */
export function classifyCodexError(err: unknown): CodexErrorKind {
  if (!(err instanceof Error)) return "error";
  const msg = err.message;
  if (
    msg.includes("ENOENT") ||
    /command not found/i.test(msg) ||
    /spawn .*codex/i.test(msg) ||
    /codex.*not found/i.test(msg)
  ) {
    return "no-cli";
  }
  if (
    /transport closed/i.test(msg) ||
    /\bclosed\b/.test(msg) ||
    /ECONNREFUSED/i.test(msg) ||
    /WebSocket .*closed/i.test(msg)
  ) {
    return "no-server";
  }
  return "error";
}

function statusFromAccountState(state: AccountState): CodexStatus {
  if (state.kind === "authenticated") {
    return { kind: "authenticated", account: state.account };
  }
  return { kind: "unauthenticated", requiresOpenaiAuth: state.requiresOpenaiAuth };
}

function statusFromError(err: unknown): CodexStatus {
  const kind = classifyCodexError(err);
  const error = err instanceof Error ? err.message : String(err);
  if (kind === "no-cli") return { kind: "no-cli", error };
  if (kind === "no-server") return { kind: "no-server", error };
  return { kind: "error", error };
}

export interface UseCodexStatusResult {
  status: CodexStatus;
  /** 強制再フェッチ。ボタン押下や login 完了時に呼ぶ。 */
  refresh: () => Promise<void>;
}

/**
 * Codex 接続/認証状態 hook。
 * テスト容易性のため client を inject 可能 (省略時は singleton)。
 */
export function useCodexStatus(client: CodexBrowserClient = defaultClient): UseCodexStatusResult {
  const [status, setStatus] = useState<CodexStatus>({ kind: "checking" });
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!aliveRef.current) return;
    setStatus({ kind: "checking" });
    try {
      const state = await client.account.read();
      if (!aliveRef.current) return;
      setStatus(statusFromAccountState(state));
    } catch (err) {
      if (!aliveRef.current) return;
      setStatus(statusFromError(err));
    }
  }, [client]);

  useEffect(() => {
    aliveRef.current = true;
    queueMicrotask(() => { if (aliveRef.current) void refresh(); });

    const unsub = client.subscribeNotification((n: CodexNotification) => {
      if (n.method === "account/login/completed" || n.method === "account/updated") {
        void refresh();
      }
    });

    return () => {
      aliveRef.current = false;
      unsub();
    };
  }, [client, refresh]);

  return { status, refresh };
}
