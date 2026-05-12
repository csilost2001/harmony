import type { ProcessFlow } from "../types/action";
import type { CodexBrowserClient } from "./codexClient";
import { codexClient as defaultClient } from "./codexClient";
import type { CodexNotification } from "./types";

const DEFAULT_TIMEOUT_MS = 180_000;

export interface ReviewProcessFlowOptions {
  client?: CodexBrowserClient;
  current: ProcessFlow;
  focus?: string;
  onDelta?: (text: string) => void;
  timeoutMs?: number;
}

export async function reviewProcessFlowWithCodex({
  client = defaultClient,
  current,
  focus,
  onDelta,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ReviewProcessFlowOptions): Promise<string> {
  const threadResponse = await client.thread.start({
    ephemeral: true,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    baseInstructions: [
      "You review Harmony ProcessFlow JSON for Japanese business application designers.",
      "Return concise Japanese review findings in Markdown.",
      "Prioritize correctness, missing branches, validation, transaction boundaries, error handling, and draft-state warnings.",
      "Do not propose global schema changes unless absolutely necessary.",
    ].join("\n"),
  });
  const threadId = readThreadId(threadResponse);
  const completion = waitForAgentText(client, threadId, timeoutMs, onDelta);

  try {
    await client.turn.start({
      threadId,
      input: [{
        type: "text",
        text: buildPrompt(current, focus?.trim() ?? ""),
        text_elements: [],
      }],
    });
  } catch (err) {
    completion.cancel();
    throw err;
  }

  return (await completion.promise).trim();
}

function buildPrompt(current: ProcessFlow, focus: string): string {
  return [
    "次の Harmony ProcessFlow JSON をレビューしてください。",
    "",
    focus ? `重点観点: ${focus}` : "重点観点: 全体レビュー",
    "",
    "出力形式:",
    "- Must-fix / Should-fix / Nit の見出しで分類してください。",
    "- 指摘は action id / step id / path を可能な範囲で明記してください。",
    "- 問題が無い分類は「なし」と書いてください。",
    "",
    "ProcessFlow JSON:",
    JSON.stringify(current, null, 2),
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
      reject(new Error("Codex レビューがタイムアウトしました"));
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
          reject(new Error(turn.error?.message ?? "Codex レビューに失敗しました"));
          return;
        }
        const text = (completedText || deltaText).trim();
        if (!text) {
          reject(new Error("Codex レビュー結果が空です"));
          return;
        }
        resolve(text);
      }
    });
  });

  return {
    promise,
    cancel: cleanup,
  };
}
