import { Injectable } from '@nestjs/common';
import { MissingApiKeyError } from './errors';

export interface AiInvokeParams {
  modelRef: string;
  messages: Array<{ role: string; content: string }>;
  responseFormat?: 'text' | 'json';
}

export interface AiInvocationResult {
  text?: string;
  object?: unknown;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

@Injectable()
export class AiRuntimeService {
  async invoke(params: AiInvokeParams): Promise<AiInvocationResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === '') {
      throw new MissingApiKeyError('ANTHROPIC_API_KEY is not set');
    }
    // Real implementation (Anthropic SDK call) is only used in live API mode.
    // In mock mode, jest.spyOn replaces this method entirely.
    throw new Error(
      'AiRuntimeService.invoke real implementation not provided (use mock or RUN_AI_INTEGRATION=1)',
    );
  }
}
