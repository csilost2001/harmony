/**
 * AI step kind (aiCall / aiAgent) と modelEndpoints catalog の core schema 動作証明 (#935)。
 *
 * examples/* には sample 移行 (Phase 2) 完了まで AI step kind 使用箇所が無いため、
 * samples-v3.schema.test.ts では新 step kind が validator を通っているか検証できない。
 * 本ファイルが「core schema が新 step kind を認識し、想定通り valid/invalid 判定する」を test fixture で証明する。
 *
 * 関連: project_ai_step_kind_core_2026_05_08.md
 */
import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = join(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateProcessFlow: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const f of readdirSync(v3Dir)) {
    if (!f.endsWith(".json")) continue;
    const schemaObj = loadJson(join(v3Dir, f)) as { $id?: string };
    if (typeof schemaObj.$id !== "string") continue;
    ajv.addSchema(schemaObj as object, schemaObj.$id);
  }
  const v = ajv.getSchema(
    "https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/process-flow.v3.schema.json"
  );
  if (!v) throw new Error("process-flow.v3.schema.json not loaded");
  validateProcessFlow = v;
});

function dumpErrors(): string {
  return (validateProcessFlow.errors ?? [])
    .slice(0, 10)
    .map((e) => `  ${e.instancePath || "<root>"} ${e.keyword}: ${e.message ?? ""}`)
    .join("\n");
}

// 共通の minimal envelope (meta + actions skeleton)
function envelope(action: object) {
  return {
    $schema: "../../../../schemas/v3/process-flow.v3.schema.json",
    meta: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test",
      description: "test fixture for AI step kind",
      kind: "common" as const,
      maturity: "draft" as const,
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    },
    context: {
      catalogs: {
        secrets: {
          anthropicApiKey: { source: "env", name: "ANTHROPIC_API_KEY" },
          openaiApiKey: { source: "env", name: "OPENAI_API_KEY" },
        },
        modelEndpoints: {
          summarizeModel: {
            provider: "anthropic" as const,
            model: "claude-opus-4-7",
            auth: { kind: "bearer", tokenRef: "@secret.anthropicApiKey" },
            defaults: { temperature: 0.7, maxTokens: 1024 },
            fallback: "summarizeModelFallback",
          },
          summarizeModelFallback: {
            provider: "openai" as const,
            model: "gpt-4o",
            auth: { kind: "bearer", tokenRef: "@secret.openaiApiKey" },
          },
          ollamaLocal: {
            provider: "ollama" as const,
            model: "llama3.1:70b",
            endpoint: "http://localhost:11434",
            auth: { kind: "none" },
          },
        },
      },
    },
    actions: [action],
  };
}

const baseAction = (steps: unknown[]) => ({
  id: "act-001",
  name: "Test action",
  trigger: "submit" as const,
  description: "test",
  maturity: "draft" as const,
  inputs: [],
  outputs: [],
  responses: [{ id: "200-ok", status: 200, description: "ok" }],
  steps,
});

describe("AI step kind core schema (#935)", () => {
  describe("aiCall — valid fixtures", () => {
    it("basic text + tools + structuredObject response", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiCall",
            description: "本文を 3-5 文で要約する",
            modelRef: "summarizeModel",
            messages: [
              { role: "system", content: "あなたは日本語要約の専門家です。" },
              { role: "user", content: "@inputs.body" },
            ],
            tools: [{ kind: "functionRef", ref: "lookupGlossary" }],
            toolChoice: "auto",
            responseFormat: {
              kind: "structuredObject",
              schema: {
                type: "object",
                properties: { summary: { type: "string" }, keywords: { type: "array" } },
                required: ["summary"],
              },
              name: "SummarizeResult",
            },
            parameters: { temperature: 0.3, maxTokens: 512 },
            outputBinding: { name: "aiResponse" },
            outcomes: { failure: { action: "abort" } },
          },
        ])
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });

    it("vision input (image content block via fileRef)", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiCall",
            description: "写真の alt text を生成する",
            modelRef: "summarizeModel",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "この画像の alt テキストを日本語で 40-100 字で生成してください。" },
                  { type: "image", source: { kind: "fileRef", ref: "@inputs.photo" } },
                ],
              },
            ],
            outputBinding: { name: "altResponse" },
          },
        ])
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });

    it("inline tool definition", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiCall",
            description: "tag 提案",
            modelRef: "summarizeModel",
            messages: [{ role: "user", content: "@inputs.body" }],
            tools: [
              {
                kind: "inline",
                name: "suggestTag",
                description: "本文からタグ候補を返す",
                parameters: {
                  type: "object",
                  properties: { name: { type: "string" }, confidence: { type: "number" } },
                  required: ["name", "confidence"],
                },
              },
            ],
            toolChoice: { name: "suggestTag" },
            outputBinding: { name: "tagResponse" },
          },
        ])
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });
  });

  describe("aiAgent — valid fixture", () => {
    it("multi-step agent loop with tools and maxIterations", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiAgent",
            description: "顧客問い合わせを agent loop で解決する",
            modelRef: "summarizeModel",
            messages: [
              { role: "system", content: "あなたはサポートエージェントです。" },
              { role: "user", content: "@inputs.query" },
            ],
            tools: [
              { kind: "functionRef", ref: "searchDb" },
              { kind: "functionRef", ref: "createTicket" },
            ],
            maxIterations: 5,
            parameters: { temperature: 0.2 },
            outputBinding: { name: "agentResult" },
          },
        ])
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });
  });

  describe("modelEndpoints catalog — provider variants", () => {
    it("all built-in providers + custom extension provider", () => {
      const data = envelope(baseAction([]));
      const me = (data.context.catalogs as Record<string, Record<string, unknown>>).modelEndpoints;
      me.gpt = { provider: "openai", model: "gpt-4o", auth: { kind: "bearer", tokenRef: "@secret.openaiApiKey" } };
      me.gemini = { provider: "google", model: "gemini-2.0-flash", auth: { kind: "apiKey", tokenRef: "@secret.openaiApiKey", headerName: "x-goog-api-key" } };
      me.bedrock = { provider: "aws-bedrock", model: "amazon.nova-pro-v1:0", auth: { kind: "iamRole" } };
      me.azure = { provider: "azure-openai", model: "gpt-4o", endpoint: "https://example.openai.azure.com", auth: { kind: "azureAd" } };
      me.custom = { provider: "harmony:in-house-llm", model: "internal-v1", auth: { kind: "none" } };
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });
  });

  describe("invalid fixtures — must be rejected", () => {
    it("aiCall without modelRef", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiCall",
            description: "no modelRef",
            messages: [{ role: "user", content: "x" }],
          },
        ])
      );
      expect(validateProcessFlow(data)).toBe(false);
    });

    it("aiCall with empty messages array", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiCall",
            description: "empty messages",
            modelRef: "summarizeModel",
            messages: [],
          },
        ])
      );
      expect(validateProcessFlow(data)).toBe(false);
    });

    it("aiAgent without tools (should use aiCall instead)", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiAgent",
            description: "no tools",
            modelRef: "summarizeModel",
            messages: [{ role: "user", content: "x" }],
          },
        ])
      );
      expect(validateProcessFlow(data)).toBe(false);
    });

    it("aiAgent with tools: [] (empty array, minItems=1 violation)", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiAgent",
            description: "empty tools array",
            modelRef: "summarizeModel",
            messages: [{ role: "user", content: "x" }],
            tools: [],
          },
        ])
      );
      expect(validateProcessFlow(data)).toBe(false);
    });

    it("modelEndpoint with unknown provider (not matching enum or extension pattern)", () => {
      const data = envelope(baseAction([]));
      const me = (data.context.catalogs as Record<string, Record<string, unknown>>).modelEndpoints;
      me.bad = { provider: "InvalidProvider", model: "x" };
      expect(validateProcessFlow(data)).toBe(false);
    });

    it("aiCall with structuredObject responseFormat missing schema", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiCall",
            description: "x",
            modelRef: "summarizeModel",
            messages: [{ role: "user", content: "x" }],
            responseFormat: { kind: "structuredObject" },
          },
        ])
      );
      expect(validateProcessFlow(data)).toBe(false);
    });

    it("aiCall with image content block but invalid source kind", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "aiCall",
            description: "x",
            modelRef: "summarizeModel",
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { kind: "filepath", path: "/tmp/x.png" } },
                ],
              },
            ],
          },
        ])
      );
      expect(validateProcessFlow(data)).toBe(false);
    });
  });
});
