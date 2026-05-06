/**
 * Claude API mock helper
 *
 * P5: jest.spyOn ベースの mock factory。
 * NestJS HttpService (Axios ラッパー) の post() を RxJS Observable として stub する。
 *
 * 使用方法:
 *   const spy = mockClaudeApiSuccess(httpService, JSON.stringify([...]));
 *   // テスト実行
 *   spy.mockRestore(); // afterEach で必ず呼ぶ
 *
 * #865 解決後 (AI provider 抽象化):
 *   HTTP_SERVICE_SPY_TARGET を provider interface method に変更すること。
 *   差替えポイント: jest.spyOn(httpService, 'post') → jest.spyOn(aiProvider, 'complete')
 */
import type { HttpService } from '@nestjs/axios';
import type { AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';

// ──────────────────────────────────────────────────────────────
// 型定義
// ──────────────────────────────────────────────────────────────

export interface MockClaudeTagCandidate {
  slug: string;
  name: string;
  confidence: number;
}

export interface MockClaudeApiResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

// ──────────────────────────────────────────────────────────────
// mock 生成ヘルパー
// ──────────────────────────────────────────────────────────────

/**
 * Claude API の正常レスポンスを mock する。
 *
 * @param httpService - NestJS HttpService インスタンス (module から取得)
 * @param responseText - content[0].text に設定するテキスト
 *   タグ提案の場合は JSON.stringify(candidates[]) を渡す
 * @returns jest.SpyInstance (afterEach で mockRestore() すること)
 *
 * @example
 *   const tags = [
 *     { slug: 'cooking', name: '料理', confidence: 0.9 },
 *     { slug: 'recipe', name: 'レシピ', confidence: 0.7 },
 *   ];
 *   const spy = mockClaudeApiSuccess(httpService, JSON.stringify(tags));
 */
export function mockClaudeApiSuccess(
  httpService: HttpService,
  responseText: string,
): jest.SpyInstance {
  const mockResponse: AxiosResponse<MockClaudeApiResponse> = {
    data: {
      id: 'msg_mock_ai_tag_suggest_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: responseText }],
      // Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
      // model: リテラル 'claude-opus-4-7' を使用 (#859 解決後に @conv.ai.tagSuggestModel へ)
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 100 },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };

  return jest.spyOn(httpService, 'post').mockReturnValue(of(mockResponse));
}

/**
 * Claude API の HTTP エラーレスポンスを mock する。
 * retryPolicy.maxAttempts 回連続してエラーを返す。
 *
 * @param httpService - NestJS HttpService インスタンス
 * @param statusCode - mock する HTTP status code (502 = AI_API_ERROR)
 * @param times - エラーを返す回数 (retryPolicy.maxAttempts = 2 に合わせる)
 * @returns jest.SpyInstance (afterEach で mockRestore() すること)
 *
 * @example
 *   // AI-4: maxAttempts=2 の retry 検証
 *   const spy = mockClaudeApiError(httpService, 502, 2);
 *   // ... リクエスト実行
 *   expect(spy).toHaveBeenCalledTimes(2);
 */
export function mockClaudeApiError(
  httpService: HttpService,
  statusCode: number,
  times = 1,
): jest.SpyInstance {
  const axiosError = Object.assign(new Error(`Mock HTTP ${statusCode} Error`), {
    response: {
      status: statusCode,
      statusText: statusCode === 502 ? 'Bad Gateway' : 'Error',
      data: { error: 'mock error' },
    },
    isAxiosError: true,
    code: `ERR_HTTP_${statusCode}`,
  });

  // times 回連続してエラーを throw する spy を構築
  let spy = jest.spyOn(httpService, 'post');
  for (let i = 0; i < times; i++) {
    spy = spy.mockReturnValueOnce(throwError(() => axiosError)) as jest.SpyInstance;
  }
  return spy;
}

/**
 * Claude API の malformed JSON レスポンスを mock する。
 * step-04 の JSON.parse() が SyntaxError を throw するケース。
 *
 * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-04 [ai-mode:mock]
 *   → compute step: JSON.parse(@aiResponse.content[0].text)
 *   → malformed JSON → SyntaxError → 500 Internal Server Error
 *
 * @param httpService - NestJS HttpService インスタンス
 * @returns jest.SpyInstance (afterEach で mockRestore() すること)
 */
export function mockClaudeApiBadJson(
  httpService: HttpService,
): jest.SpyInstance {
  const mockResponse: AxiosResponse<MockClaudeApiResponse> = {
    data: {
      id: 'msg_mock_bad_json',
      type: 'message',
      role: 'assistant',
      // 故意に invalid JSON テキストを返す → JSON.parse() が SyntaxError
      content: [{ type: 'text', text: 'NOT_VALID_JSON_RESPONSE {{broken}}' }],
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };

  return jest.spyOn(httpService, 'post').mockReturnValue(of(mockResponse));
}
