/**
 * AI runtime service mock helper (provider 中立形式)
 *
 * Phase 2-C 確定: AiRuntimeService.invoke (固定契約)
 *   type:        AiRuntimeService
 *   method:      invoke
 *   import path: ../src/ai/ai-runtime.service (e2e-spec から見た相対パス)
 *
 * 対象フロー: 96118ae1 (会話ターン進行)
 *   step-03: kind=aiCall, modelRef=dialogModel, responseFormat=text (default)
 *   mock 戻り値: { text: '<生成テキスト>', finishReason: 'end_turn', usage: {...} }
 *
 * PLACEHOLDER 解決表:
 * | PLACEHOLDER            | 値                              |
 * |------------------------|----------------------------------|
 * | AI_STEP_KIND           | aiCall                          |
 * | AI_MODEL_REF           | dialogModel                     |
 * | AI_PROVIDER            | anthropic                       |
 * | AI_MODEL_NAME          | claude-opus-4-7                 |
 * | AI_AUTH_KIND           | bearer                          |
 * | AI_SECRET_REF          | anthropicApiKey                 |
 * | AI_API_KEY_ENV         | ANTHROPIC_API_KEY               |
 * | RESPONSE_FORMAT_KIND   | text (default / 未指定)         |
 * | AI_OUTPUT_BINDING      | aiResponse                      |
 * | STEP_AI_ID             | step-03                         |
 * | FAILURE_RESPONSE_ID    | 502-llm-failed                  |
 * | FAILURE_RESPONSE_STATUS| 502                             |
 * | FAILURE_ERROR_CODE     | LLM_CALL_FAILED                 |
 */

import type { AiRuntimeService } from '../src/ai/ai-runtime.service';

export interface AiInvocationResult {
  text?: string;
  object?: unknown;
  raw?: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
}

// (a) text format helper — 会話ターン進行は text format
export function mockAiText(svc: AiRuntimeService, text: string): jest.SpyInstance {
  const result: AiInvocationResult = {
    text,
    finishReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 100 },
  };
  return jest.spyOn(svc, 'invoke').mockResolvedValue(result as any);
}

// (e) failure helper — AI-4 (provider 呼び出し失敗)
export function mockAiFailure(svc: AiRuntimeService, error?: Error): jest.SpyInstance {
  return jest.spyOn(svc, 'invoke').mockRejectedValue(
    error ?? new Error('Mock provider error'),
  );
}
