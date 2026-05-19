/**
 * processFlowPartialRequest — 選択範囲を context にした ProcessFlow 部分修正依頼。
 *
 * 既存の processFlowGeneration.ts と同じ Codex client 規約を使うが、
 * context chips を添付した部分修正 prompt を組み立てる。
 *
 * Codex 未認証時は "unavailable" エラーを throw する。
 */

// #1186 Phase 2-D: types/action → types/v3 移行
import type { ProcessFlow } from "../types/v3";
import { migrateProcessFlow } from "../utils/actionMigration";
import type { CodexBrowserClient } from "./codexClient";
import { codexClient as defaultClient } from "./codexClient";
import type { CodexNotification } from "./types";

const DEFAULT_TIMEOUT_MS = 180_000;

const PROCESS_FLOW_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["meta", "actions"],
  properties: {
    meta: {
      type: "object",
      additionalProperties: true,
      required: ["name", "kind"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        kind: { type: "string" },
        maturity: { type: "string", enum: ["draft", "provisional", "committed"] },
        mode: { type: "string", enum: ["upstream", "downstream"] },
      },
    },
    context: { type: "object", additionalProperties: true },
    actions: { type: "array", items: { type: "object", additionalProperties: true } },
    authoring: { type: "object", additionalProperties: true },
  },
} as const;

/** Codex 未認証など AI が利用不可な場合に throw するエラー */
export class AiUnavailableError extends Error {
  readonly kind = "unavailable";
  constructor(message = "Codex が接続されていません") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export interface PartialRequestOptions {
  /** Codex クライアント (テスト時に inject) */
  client?: CodexBrowserClient;
  /** 現在の ProcessFlow 全体 */
  current: ProcessFlow;
  /** AI に渡すコンテキスト (context chips の buildContextString() 結果) */
  contextString: string;
  /** ユーザー入力の依頼プロンプト */
  prompt: string;
  /** streaming 中に呼ばれるコールバック */
  onDelta?: (text: string) => void;
  /** タイムアウト ms */
  timeoutMs?: number;
}

export interface PartialRequestResult {
  proposed: ProcessFlow;
}

/**
 * 部分修正 AI 依頼を実行する。
 *
 * @throws {AiUnavailableError} Codex 未接続 / 未認証の場合
 * @throws {Error} その他の Codex エラー / パースエラー
 */
export async function requestProcessFlowPartial({
  client = defaultClient,
  current,
  contextString,
  prompt,
  onDelta,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: PartialRequestOptions): Promise<PartialRequestResult> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) throw new Error("依頼内容が空です");

  // Codex 認証確認
  let accountState: unknown;
  try {
    accountState = await client.account.read();
  } catch (err) {
    throw new AiUnavailableError(
      `Codex に接続できません: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const state = accountState as { kind?: string };
  if (state?.kind !== "authenticated") {
    throw new AiUnavailableError("Codex が認証されていません");
  }

  const threadResponse = await client.thread.start({
    ephemeral: true,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    baseInstructions: [
      "You modify or extend a Harmony ProcessFlow JSON for a Japanese business application designer.",
      "Return only a complete JSON object. Do not include Markdown fences or commentary.",
      "Preserve meta.id, meta.createdAt, meta.screenId, and meta.kind unless explicitly asked to change.",
      "Preserve authoring.markers. Apply changes only to the portions relevant to the user request.",
      "Use draft-state semantics: incomplete details may remain draft/provisional.",
    ].join("\n"),
  });
  const threadId = readThreadId(threadResponse);

  const completion = waitForAgentText(client, threadId, timeoutMs, onDelta);

  try {
    await client.turn.start({
      threadId,
      input: [{
        type: "text",
        text: buildPrompt(current, contextString, trimmedPrompt),
        text_elements: [],
      }],
      outputSchema: PROCESS_FLOW_OUTPUT_SCHEMA,
    });
  } catch (err) {
    completion.cancel();
    throw err;
  }

  const text = await completion.promise;
  const parsed = parseJsonObject(text);
  const proposed = migrateProcessFlow(parsed);

  // 既存の identity フィールドを維持
  proposed.meta = {
    ...proposed.meta,
    id: current.meta.id,
    createdAt: current.meta.createdAt,
    updatedAt: current.meta.updatedAt,
    screenId: current.meta.screenId ?? proposed.meta.screenId,
    kind: proposed.meta.kind ?? current.meta.kind,
  };
  // markers はユーザ/システム生成リソースで AI 提案では消さない (S-1 fix、独立レビュー指摘)
  proposed.authoring = {
    ...(proposed.authoring ?? {}),
    markers: current.authoring?.markers ?? proposed.authoring?.markers ?? [],
  };

  return { proposed };
}

function buildPrompt(current: ProcessFlow, contextString: string, prompt: string): string {
  const parts = [
    "次の依頼に基づいて、Harmony の ProcessFlow JSON を部分修正してください。",
    "",
    "依頼内容:",
    prompt,
  ];

  if (contextString) {
    parts.push("", "選択されたコンテキスト:", contextString);
  }

  parts.push(
    "",
    "現在の ProcessFlow JSON:",
    JSON.stringify(current, null, 2),
    "",
    "出力条件:",
    "- 完全な ProcessFlow JSON オブジェクトを返してください。",
    "- meta.id / meta.createdAt / meta.screenId は変更しないでください。",
    "- authoring.markers は維持してください。",
    "- 依頼に関係のない部分はそのまま維持してください。",
    "- schema は拡張せず、既存 step kind を使用してください。",
  );

  return parts.join("\n");
}

function readThreadId(response: unknown): string {
  const r = response as { thread?: { id?: unknown } };
  if (typeof r.thread?.id === "string" && r.thread.id) return r.thread.id;
  throw new Error("Codex thread.start の応答から thread.id を取得できませんでした");
}

function waitForAgentText(
  client: CodexBrowserClient,
  threadId: string,
  timeoutMs: number,
  onDelta?: (text: string) => void,
): { promise: Promise<string>; cancel: () => void } {
  let deltaText = "";
  let completedText = "";
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const promise = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("Codex 生成がタイムアウトしました"));
    }, timeoutMs);

    unsubscribe = client.subscribeNotification((n: CodexNotification) => {
      const params = n.params as Record<string, unknown>;
      if (params.threadId !== threadId) return;

      if (n.method === "item/agentMessage/delta" && typeof params.delta === "string") {
        deltaText += params.delta;
        onDelta?.(deltaText);
        return;
      }

      if (n.method === "item/completed") {
        const item = params.item as { type?: unknown; text?: unknown } | undefined;
        if (item?.type === "agentMessage" && typeof item.text === "string") {
          completedText = item.text;
          onDelta?.(completedText);
        }
        return;
      }

      if (n.method === "turn/completed") {
        const turn = params.turn as { status?: unknown; error?: { message?: string } | null } | undefined;
        cleanup();
        if (turn?.status === "failed") {
          reject(new Error(turn.error?.message ?? "Codex 生成に失敗しました"));
          return;
        }
        const text = (completedText || deltaText).trim();
        if (!text) {
          reject(new Error("Codex 生成結果が空です"));
          return;
        }
        resolve(text);
      }
    });
  });

  return {
    promise,
    cancel: () => cleanup(),
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new Error(
      `Codex 生成結果を JSON として解析できませんでした: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
