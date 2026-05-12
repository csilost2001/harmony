import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiRuntimeService } from '../ai/ai-runtime.service';
import { MissingApiKeyError } from '../ai/errors';
import { CreateTurnDto } from './dto/create-turn.dto';

@Injectable()
export class ConversationTurnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiRuntime: AiRuntimeService,
  ) {}

  async processTurn(userId: number, sessionId: number, dto: CreateTurnDto) {
    const { userInput, turnContext, generateAudio } = dto;

    // step-01: Verify session exists and belongs to user
    const session = await this.prisma.learningSession.findFirst({
      where: {
        id: sessionId,
        user_id: userId,
        status: 'in_progress',
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // step-03: Build messages and call AI
    const messages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: 'あなたは日本人英語学習者向けの会話パートナーです。自然な英語で会話をサポートしてください。',
      },
    ];

    // Spread @turnContext (AiMessageSpread)
    if (turnContext) {
      try {
        const contextMessages = JSON.parse(turnContext);
        if (Array.isArray(contextMessages)) {
          for (const t of contextMessages) {
            messages.push({ role: t.role, content: t.content });
          }
        }
      } catch {
        // ignore invalid JSON in turnContext
      }
    }

    messages.push({ role: 'user', content: userInput });

    let aiResponse: { text?: string };
    try {
      aiResponse = await this.aiRuntime.invoke({
        modelRef: 'dialogModel',
        messages,
        responseFormat: 'text',
      });
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        throw new HttpException('AI service unavailable', HttpStatus.SERVICE_UNAVAILABLE); // 503
      }
      throw new HttpException('LLM call failed', 502); // catalog.errors.LLM_CALL_FAILED
    }

    // step-04: generateAudio branch (TTS not implemented, aiAudioUrl = null)
    const aiAudioUrl: string | null = null;
    // generateAudio=true → TTS would go here, but not yet implemented

    // step-04c: Get next turn_number
    const maxTurnResult = await this.prisma.turnLog.aggregate({
      where: { session_id: sessionId },
      _max: { turn_number: true },
    });
    const nextTurn = (maxTurnResult._max.turn_number ?? 0) + 1;

    // step-05: INSERT turn_log
    const newTurn = await this.prisma.turnLog.create({
      data: {
        session_id: sessionId,
        turn_number: nextTurn,
        user_input: userInput,
        ai_response: aiResponse.text ?? null,
        ai_audio_url: aiAudioUrl,
        llm_context: turnContext ?? null,
      },
    });

    // step-07: Return response
    return {
      aiResponseText: aiResponse.text ?? '',
      aiAudioUrl,
      turnId: newTurn.id,
    };
  }
}
