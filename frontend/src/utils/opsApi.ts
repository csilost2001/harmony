/** 連携と運用の RPC (backend/src/wsHandlers/ops.ts) の、型つきの呼び出し */
import type {
  AccessFile, Approval, ApprovalState, ApprovalStatus, CommentThread, DocTemplate, DriftRow, JsonChange, NotifyEvent, NotifyFormat, OpsEntityKind, Role,
} from "@harmony/shared";
import { mcpBridge } from "../mcp/mcpBridge";

const call = async <T>(method: Parameters<typeof mcpBridge.request>[0], params?: unknown): Promise<T> => (await mcpBridge.request(method, params)) as T;

export interface ApprovalRow extends Approval { status: ApprovalStatus; name: string; nextStates: Array<{ to: ApprovalState; needs: Role }> }
export interface AuditEntry { at: string; actor: string; action: string; target?: string; detail?: string; via?: "ui" | "ai" | "server" }
export interface WebhookView { id: string; name: string; format: NotifyFormat; events: NotifyEvent[]; enabled: boolean; urlMasked: string }
export interface WebhookInput { id?: string; name: string; url?: string; format: NotifyFormat; events: NotifyEvent[]; enabled: boolean }
export interface GitFile { path: string; status: string; staged: boolean }
export interface GitStatus { isRepo: boolean; ownRepo: boolean; branch?: string; detached?: boolean; files: GitFile[]; clean: boolean; identityConfigured: boolean }
export interface GitCommitInfo { hash: string; author: string; at: string; subject: string }
export interface RegenDiff { path: string; sources: Array<{ kind: OpsEntityKind; id: string; state: "changed" | "deleted" | "no-snapshot"; changes: JsonChange[]; truncated: boolean }> }
export interface VersionInfo { version: string; commit?: string; commitFull?: string; branch?: string; dirty?: boolean; source?: "git" | "image"; builtAt?: string; repo?: string; startedAt: string; notes: Array<{ date: string; title: string; pr?: string }>; notesTotal: number }
export interface UpdateCheck { status: "current" | "behind" | "unknown"; message: string; local?: string; remote?: string; behindBy?: number; aheadBy?: number }
export interface RevisionSuggestion { since: string; items: Array<{ kind: OpsEntityKind; id: string; name: string; saves: number; lastAt: string }>; text: string; truncated: boolean }

export const opsApi = {
  templateLoad: () => call<{ template: DocTemplate; problems: string[] }>("documentTemplate.load"),
  templateSave: (template: DocTemplate, discardUnreadable = false) => call<{ template: DocTemplate; problems: string[] }>("documentTemplate.save", { template, discardUnreadable }),
  revisionsSuggest: (since?: string) => call<RevisionSuggestion>("revisions.suggest", since ? { since } : {}),
  approvalsLoad: () => call<{ rows: ApprovalRow[]; problems: string[] }>("approvals.load"),
  approvalTransition: (kind: OpsEntityKind, id: string, to: ApprovalState, note?: string) => call<ApprovalRow>("approvals.transition", { kind, id, to, note }),
  commentsLoad: () => call<{ threads: CommentThread[]; problems: string[] }>("reviewComments.load"),
  commentAdd: (p: { target?: { kind: OpsEntityKind; id: string; path?: string }; threadId?: string; text: string }) => call<{ threadId: string }>("reviewComments.add", p),
  commentResolve: (threadId: string, resolved: boolean) => call<{ ok: true }>("reviewComments.resolve", { threadId, resolved }),
  accessLoad: () => call<{ access: AccessFile; problems: string[]; you: { name: string; role: Role | null; enforced: boolean } }>("access.load"),
  accessSave: (users: AccessFile["users"], policy: AccessFile["policy"], discardUnreadable = false) => call<{ access: AccessFile; problems: string[] }>("access.save", { users, policy, discardUnreadable }),
  auditList: (q: { actor?: string; action?: string; q?: string; since?: string; until?: string; limit?: number } = {}) => call<{ entries: AuditEntry[]; actors: string[]; total: number }>("audit.list", q),
  notifyLoad: () => call<{ webhooks: WebhookView[]; problems: string[] }>("notify.load"),
  notifySave: (webhooks: WebhookInput[], discardUnreadable = false) => call<{ saved: number }>("notify.save", { webhooks, discardUnreadable }),
  notifyTest: (id: string) => call<{ ok: boolean; status?: number; error?: string }>("notify.test", { id }),
  gitStatus: () => call<GitStatus>("git.status"),
  gitDiff: (path: string) => call<{ diff: string; truncated: boolean }>("git.diff", { path }),
  gitLog: (limit = 30) => call<{ commits: GitCommitInfo[] }>("git.log", { limit }),
  gitBranches: () => call<{ branches: Array<{ name: string; current: boolean }> }>("git.branches"),
  gitCommit: (message: string, paths: string[]) => call<{ commit: string; files: number }>("git.commit", { message, paths }),
  gitCheckout: (branch: string, create = false) => call<{ branch: string }>("git.checkout", { branch, create }),
  gitInit: () => call<{ ok: true }>("git.init"),
  generationStatus: () => call<{ rows: DriftRow[]; problems: string[] }>("generation.status"),
  generationDiff: (path?: string) => call<{ diffs: RegenDiff[] }>("generation.diff", path ? { path } : {}),
  version: () => call<VersionInfo>("app.version"),
  checkUpdate: () => call<UpdateCheck>("app.checkUpdate"),
};
