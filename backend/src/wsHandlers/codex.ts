/**
 * Codex App Server 系 RPC handler (#1144 Phase-2 — #867)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 10 RPC method を分離:
 * - codex.account.read / login.start / login.cancel / logout / rateLimits.read
 * - codex.turn.start / steer / interrupt
 * - codex.thread.start / resume
 * - codex.model.list
 * - codex.serverRequest.respond
 *
 * すべて `bridge.codex` (CodexBroadcastBridge) を adapter として呼び出す。
 * 機能不変 — case body は一字一句変更なし (this._getCodexConnection() → bridge.codex.getConnection())。
 */
import type { TurnStartParams } from "../codex/types/v2/TurnStartParams.js";
import type { TurnSteerParams } from "../codex/types/v2/TurnSteerParams.js";
import type { TurnInterruptParams } from "../codex/types/v2/TurnInterruptParams.js";
import type { ThreadStartParams } from "../codex/types/v2/ThreadStartParams.js";
import type { ThreadResumeParams } from "../codex/types/v2/ThreadResumeParams.js";
import type { RpcHandlerMap } from "./types.js";

export const codexHandlers: RpcHandlerMap = {
  // ── Codex App Server (#867) ──────────────────────────────────────────
  // All codex.* methods delegate to the CodexConnection singleton.
  // The connection is established on first use (on-demand).

  "codex.account.read": async ({ respond, respondError, bridge }) => {
    try {
      const state = await bridge.codex.getConnection().account.readState();
      respond(state);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.account.login.start": async ({ respond, respondError, bridge }) => {
    try {
      const pending = await bridge.codex.getConnection().account.startChatgptLogin();
      pending.completion.catch(() => {
        // Browser observes login completion via Codex notifications; avoid unhandled rejections here.
      });
      respond({ loginId: pending.loginId, authUrl: pending.authUrl });
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.account.login.cancel": async ({ params, respond, respondError, bridge }) => {
    const { loginId: cxLoginId } = (params ?? {}) as { loginId: string };
    try {
      await bridge.codex.getConnection().account.cancelChatgptLogin(cxLoginId);
      respond({ cancelled: true });
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.account.logout": async ({ respond, respondError, bridge }) => {
    try {
      await bridge.codex.getConnection().account.logout();
      respond({ ok: true });
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.account.rateLimits.read": async ({ respond, respondError, bridge }) => {
    try {
      const result = await bridge.codex.getConnection().account.readRateLimits();
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.turn.start": async ({ params, respond, respondError, bridge }) => {
    try {
      const result = await bridge.codex.getConnection().request<unknown>(
        "turn/start",
        params as TurnStartParams,
      );
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.turn.steer": async ({ params, respond, respondError, bridge }) => {
    try {
      const result = await bridge.codex.getConnection().request<unknown>(
        "turn/steer",
        params as TurnSteerParams,
      );
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.turn.interrupt": async ({ params, respond, respondError, bridge }) => {
    try {
      const result = await bridge.codex.getConnection().request<unknown>(
        "turn/interrupt",
        params as TurnInterruptParams,
      );
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.thread.start": async ({ params, respond, respondError, bridge }) => {
    try {
      const result = await bridge.codex.getConnection().request<unknown>(
        "thread/start",
        params as ThreadStartParams,
      );
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.thread.resume": async ({ params, respond, respondError, bridge }) => {
    try {
      const result = await bridge.codex.getConnection().request<unknown>(
        "thread/resume",
        params as ThreadResumeParams,
      );
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.model.list": async ({ respond, respondError, bridge }) => {
    try {
      const result = await bridge.codex.getConnection().request<unknown>("model/list", {});
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "codex.serverRequest.respond": async ({ params, respond, bridge }) => {
    const { requestId: srId, result: srResult, error: srError } = (params ?? {}) as {
      requestId: string;
      result?: unknown;
      error?: { code: number; message: string };
    };
    if (srError) {
      bridge.codex.resolveServerRequest(srId, srError, true);
    } else {
      bridge.codex.resolveServerRequest(srId, srResult, false);
    }
    respond({ ok: true });
  },
};
