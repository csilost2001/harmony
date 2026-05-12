import type { ProcessFlow } from "../types/action";
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

export interface GenerateProcessFlowOptions {
  client?: CodexBrowserClient;
  current: ProcessFlow;
  requirement: string;
  onDelta?: (text: string) => void;
  timeoutMs?: number;
}

export async function generateProcessFlowWithCodex({
  client = defaultClient,
  current,
  requirement,
  onDelta,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: GenerateProcessFlowOptions): Promise<ProcessFlow> {
  const trimmed = requirement.trim();
  if (!trimmed) throw new Error("生成要件が空です");

  const threadResponse = await client.thread.start({
    ephemeral: true,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    baseInstructions: [
      "You generate Harmony ProcessFlow JSON for a Japanese business application designer.",
      "Return only a complete JSON object. Do not include Markdown fences or commentary.",
      "Preserve the existing ProcessFlow identity fields unless the user explicitly asks for names/descriptions.",
      "Use draft-state semantics: incomplete details may remain draft/provisional and should not block generation.",
    ].join("\n"),
  });
  const threadId = readThreadId(threadResponse);

  const completion = waitForAgentText(client, threadId, timeoutMs, onDelta);

  try {
    await client.turn.start({
      threadId,
      input: [{
        type: "text",
        text: buildPrompt(current, trimmed),
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
  return migrateProcessFlow(parsed);
}

export function mergeGeneratedProcessFlow(current: ProcessFlow, generated: ProcessFlow): ProcessFlow {
  const next = migrateProcessFlow(generated);
  next.meta = {
    ...next.meta,
    id: current.meta.id,
    createdAt: current.meta.createdAt,
    updatedAt: current.meta.updatedAt,
    screenId: current.meta.screenId ?? next.meta.screenId,
    kind: next.meta.kind ?? current.meta.kind,
  };
  next.authoring = current.authoring;
  return next;
}

function buildPrompt(current: ProcessFlow, requirement: string): string {
  return [
    "次の要件に基づいて、Harmony の ProcessFlow JSON を更新してください。",
    "",
    "要件:",
    requirement,
    "",
    "現在の ProcessFlow JSON:",
    JSON.stringify(current, null, 2),
    "",
    "出力条件:",
    "- 完全な ProcessFlow JSON オブジェクトだけを返してください。",
    "- meta.id / meta.createdAt / meta.screenId は維持してください。",
    "- actions[].steps[] は Harmony の既存 step kind を使ってください。",
    "- 不明点は authoring.notes や draft/provisional maturity で表現し、schema は拡張しないでください。",
  ].join("\n");
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
    cancel: () => {
      cleanup();
    },
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new Error(`Codex 生成結果を JSON として解析できませんでした: ${err instanceof Error ? err.message : String(err)}`);
  }
}
