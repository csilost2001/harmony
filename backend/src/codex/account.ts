import type { CodexClient } from "./client.js";
import type { Account } from "./types/v2/Account.js";
import type { GetAccountResponse } from "./types/v2/GetAccountResponse.js";
import type { GetAccountRateLimitsResponse } from "./types/v2/GetAccountRateLimitsResponse.js";
import type { LoginAccountParams } from "./types/v2/LoginAccountParams.js";
import type { LoginAccountResponse } from "./types/v2/LoginAccountResponse.js";

export type AccountState =
  | { kind: "unauthenticated"; requiresOpenaiAuth: boolean }
  | { kind: "authenticated"; account: Account };

export interface ChatgptLoginPending {
  loginId: string;
  authUrl: string;
  /** Resolves on `account/login/completed` (success=true); rejects on error or cancel. */
  completion: Promise<void>;
  /** Cancel the pending login. Sends `account/login/cancel`. */
  cancel: () => Promise<void>;
}

interface PendingLogin {
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Account / authentication facade over `CodexClient`.
 *
 * Caller wires up `account/login/completed` and `account/updated` notifications
 * by invoking {@link AccountManager.handleLoginCompletedNotification} from the
 * CodexClient onNotification handler.
 */
export class AccountManager {
  private readonly client: CodexClient;
  private readonly pendingLogins = new Map<string, PendingLogin>();

  constructor(client: CodexClient) {
    this.client = client;
  }

  /** Read current account state. Single round-trip, no caching. */
  async readState(): Promise<AccountState> {
    const result = await this.client.request<GetAccountResponse>("account/read", {});
    if (result.account) return { kind: "authenticated", account: result.account };
    return { kind: "unauthenticated", requiresOpenaiAuth: result.requiresOpenaiAuth };
  }

  /**
   * Start the ChatGPT OAuth flow. Returns the auth URL the caller must open in
   * a browser plus a promise that resolves when the user completes sign-in
   * (delivered via `account/login/completed` notification).
   */
  async startChatgptLogin(): Promise<ChatgptLoginPending> {
    const params: LoginAccountParams = { type: "chatgpt" };
    const response = await this.client.request<LoginAccountResponse>(
      "account/login/start",
      params,
    );
    if (response.type !== "chatgpt") {
      throw new Error(`Unexpected login response type: ${response.type}`);
    }
    const loginId = response.loginId;

    let resolveCompletion!: () => void;
    let rejectCompletion!: (err: Error) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    this.pendingLogins.set(loginId, {
      resolve: resolveCompletion,
      reject: rejectCompletion,
    });

    return {
      loginId,
      authUrl: response.authUrl,
      completion,
      cancel: () => this.cancelChatgptLogin(loginId),
    };
  }

  async cancelChatgptLogin(loginId: string): Promise<void> {
    const pending = this.pendingLogins.get(loginId);
    if (pending) {
      this.pendingLogins.delete(loginId);
      pending.reject(new Error("ChatGPT login cancelled"));
    }
    await this.client.request("account/login/cancel", { loginId });
  }

  async logout(): Promise<void> {
    await this.client.request("account/logout", undefined);
  }

  async readRateLimits(): Promise<GetAccountRateLimitsResponse> {
    return this.client.request<GetAccountRateLimitsResponse>(
      "account/rateLimits/read",
      undefined,
    );
  }

  /**
   * Forward `account/login/completed` notifications. Invoked by the higher-level
   * notification dispatcher; resolves or rejects the pending promise from
   * {@link startChatgptLogin}.
   */
  handleLoginCompletedNotification(params: {
    loginId: string | null;
    success: boolean;
    error: string | null;
  }): void {
    if (!params.loginId) return;
    const pending = this.pendingLogins.get(params.loginId);
    if (!pending) return;
    this.pendingLogins.delete(params.loginId);
    if (params.success) pending.resolve();
    else pending.reject(new Error(params.error ?? "ChatGPT login failed"));
  }

  /** Reject any in-flight logins. Call on transport close. */
  abortPending(reason: Error): void {
    for (const [, p] of this.pendingLogins) p.reject(reason);
    this.pendingLogins.clear();
  }
}
