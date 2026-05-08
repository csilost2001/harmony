/**
 * Minimal frontend-local type declarations for Codex API.
 *
 * Backend imports are out of scope for the frontend tsconfig (`include: ["src"]`),
 * and the auto-generated backend types reference cross-file chains (e.g. PlanType,
 * RateLimitWindow, CreditsSnapshot) which would be cumbersome to replicate fully.
 *
 * Strategy: typed for account/rate-limit (UI cares about these), unknown for
 * turn/thread/model params and responses (UI passes them through opaquely).
 *
 * These mirror the shapes defined in backend/src/codex/account.ts and
 * backend/src/codex/types/v2/*.ts — keep in sync if the backend types change.
 */

// ── Account ──────────────────────────────────────────────────────────────────

export type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string; planType: string }
  | { type: "amazonBedrock" };

/**
 * Mirrors backend `AccountState` from backend/src/codex/account.ts.
 */
export type AccountState =
  | { kind: "unauthenticated"; requiresOpenaiAuth: boolean }
  | { kind: "authenticated"; account: CodexAccount };

/**
 * Mirrors `LoginAccountResponse` (chatgpt variant only — the variant this
 * client exposes publicly).
 */
export interface ChatgptLoginStartResult {
  loginId: string;
  authUrl: string;
}

// ── Rate limits ───────────────────────────────────────────────────────────────

/** Simplified mirror of `RateLimitSnapshot` from backend. */
export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  /** primary window (may be null if not applicable) */
  primary: unknown | null;
  secondary: unknown | null;
  credits: unknown | null;
  planType: string | null;
  rateLimitReachedType: string | null;
}

/** Mirrors `GetAccountRateLimitsResponse` from backend. */
export interface GetAccountRateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
}

// ── Server request (approval) ─────────────────────────────────────────────────

export interface CodexServerRequest {
  id: string;
  method: string;
  params: unknown;
}

export type ApprovalHandler = (
  req: CodexServerRequest,
) => Promise<unknown> | unknown;

// ── Notification ──────────────────────────────────────────────────────────────

export interface CodexNotification {
  method: string;
  params: unknown;
}
