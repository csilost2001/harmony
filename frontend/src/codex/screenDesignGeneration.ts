import type { EditorKind } from "../utils/resolveEditorKind";
import { BUILTIN_PRIMITIVE_NAMES } from "../puck/buildConfig";
import type { CodexBrowserClient } from "./codexClient";
import { codexClient as defaultClient } from "./codexClient";
import type { CodexNotification } from "./types";

const DEFAULT_TIMEOUT_MS = 180_000;

const GRAPESJS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["pages"],
  properties: {
    pages: { type: "array", items: { type: "object", additionalProperties: true } },
    styles: { type: "array", items: { type: "object", additionalProperties: true } },
    assets: { type: "array", items: { type: "object", additionalProperties: true } },
  },
} as const;

const PUCK_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["root", "content"],
  properties: {
    root: { type: "object", additionalProperties: true },
    content: { type: "array", items: { type: "object", additionalProperties: true } },
  },
} as const;

export interface GenerateScreenDesignOptions {
  client?: CodexBrowserClient;
  editorKind: EditorKind;
  cssFramework: string;
  screenName?: string;
  current: unknown;
  requirement: string;
  onDelta?: (text: string) => void;
  timeoutMs?: number;
}

export async function generateScreenDesignWithCodex({
  client = defaultClient,
  editorKind,
  cssFramework,
  screenName,
  current,
  requirement,
  onDelta,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: GenerateScreenDesignOptions): Promise<unknown> {
  const trimmed = requirement.trim();
  if (!trimmed) throw new Error("生成要件が空です");

  const threadResponse = await client.thread.start({
    ephemeral: true,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    baseInstructions: [
      "You generate screen design payloads for Harmony, a Japanese business application designer.",
      "Return only a complete JSON object. Do not include Markdown fences or commentary.",
      "Do not invent global schemas. Keep the output in the requested editor payload format.",
    ].join("\n"),
  });
  const threadId = readThreadId(threadResponse);
  const completion = waitForAgentText(client, threadId, timeoutMs, onDelta);

  try {
    await client.turn.start({
      threadId,
      input: [{
        type: "text",
        text: buildPrompt({ editorKind, cssFramework, screenName, current, requirement: trimmed }),
        text_elements: [],
      }],
      outputSchema: editorKind === "puck" ? PUCK_OUTPUT_SCHEMA : GRAPESJS_OUTPUT_SCHEMA,
    });
  } catch (err) {
    completion.cancel();
    throw err;
  }

  const parsed = parseJsonObject(await completion.promise);
  validatePayload(editorKind, parsed);
  return parsed;
}

function buildPrompt({
  editorKind,
  cssFramework,
  screenName,
  current,
  requirement,
}: {
  editorKind: EditorKind;
  cssFramework: string;
  screenName?: string;
  current: unknown;
  requirement: string;
}): string {
  const formatHint = editorKind === "puck"
    ? [
        "Puck Data 形式で返してください: { root: { props: {} }, content: [...] }。",
        `利用できる component type: ${BUILTIN_PRIMITIVE_NAMES.map(toComponentTypeName).join(", ")}。`,
        "各 content item には type と props を入れ、props.id は安定した英数字 ID にしてください。",
      ]
    : [
        "GrapesJS の projectData 形式で返してください。少なくとも pages を含めてください。",
        "Bootstrap 5 / Bootstrap Icons を前提に、components と styles を GrapesJS が loadProjectData できる構造にしてください。",
        "body 配下の HTML/CSS 表現で、業務画面としてそのまま編集できる構造にしてください。",
      ];

  return [
    "次の要件に基づいて Harmony の画面デザイン payload を更新してください。",
    "",
    `画面名: ${screenName || "(未設定)"}`,
    `editorKind: ${editorKind}`,
    `cssFramework: ${cssFramework}`,
    "",
    "要件:",
    requirement,
    "",
    "現在の payload:",
    JSON.stringify(current ?? null, null, 2),
    "",
    "出力条件:",
    ...formatHint.map((s) => `- ${s}`),
    "- 日本語 UI テキストを使ってください。",
    "- 見出し、主要入力、主要アクション、一覧/カードなど、業務画面として評価できる要素を含めてください。",
  ].join("\n");
}

function toComponentTypeName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function validatePayload(editorKind: EditorKind, payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    throw new Error("Codex 生成結果が object ではありません");
  }
  const p = payload as Record<string, unknown>;
  if (editorKind === "puck") {
    if (!p.root || typeof p.root !== "object" || !Array.isArray(p.content)) {
      throw new Error("Codex 生成結果が Puck Data 形式ではありません");
    }
    return;
  }
  if (!Array.isArray(p.pages)) {
    throw new Error("Codex 生成結果が GrapesJS projectData 形式ではありません");
  }
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
    cancel: cleanup,
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
