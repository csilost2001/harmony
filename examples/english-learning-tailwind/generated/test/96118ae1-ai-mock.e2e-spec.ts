/**
 * E2E テスト: POST /api/el/sessions/:sessionId/turns (会話ターン進行)
 * AI flow mock + 実 API 切替 (P5)
 *
 * // ===HARMONY_GENERATED_SECTION_START flowId=96118ae1-a0ab-401b-8584-dd645a45a81f actionId=act-001===
 *
 * ProcessFlow: 96118ae1-a0ab-401b-8584-dd645a45a81f (会話ターン進行)
 *
 * === AI flow 検出結果 ===
 * step-03: kind=aiCall, modelRef=dialogModel, responseFormat=text (未指定 → text 扱い)
 *   provider=anthropic, model=claude-opus-4-7
 *   auth.kind=bearer, tokenRef=@secret.anthropicApiKey → env: ANTHROPIC_API_KEY
 *   messages: system + spread(@turnContext) + user(@userInput)
 *   AiMessageSpread 検出: ref="@turnContext" (action.inputs.turnContext から渡る)
 *
 * === 4 観点変換結果 ===
 * AI-1: 業務フィルタ → skip (responseFormat=text, compute step に object filter なし)
 * AI-2: ANTHROPIC_API_KEY 未設定 → 503
 * AI-3: responseFormat=text → skip (parse / schema 検証ステップが無い)
 * AI-4: provider 失敗 → 502 (catalog.errors.LLM_CALL_FAILED.responseId=502-llm-failed)
 *
 * === P1/P2 テストケース (非 AI ターン) ===
 * #1: happy path → 200 + aiResponseText + turnId
 * #2: storyId 欠落 → 400 (inputs[sessionId: required])
 * #3: userInput 欠落 → 400 (inputs[userInput: required])
 * #4: JWT なし → 401
 * #5: DB 副作用: turn_logs に row が追加される (step-05 lineage.writes)
 * #6: DB 副作用: turn_logs に step-04c で算出した turn_number が設定される
 * #7: セッション存在チェック: 存在しない sessionId → 404
 *
 * // ===HARMONY_GENERATED_SECTION_END===
 */

// Spec anchor: Flow 96118ae1-a0ab-401b-8584-dd645a45a81f act-001

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest'); // Spike L-5: require で import
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';
import { AiRuntimeService } from '../src/ai/ai-runtime.service'; // Phase 2-C 固定契約
import { mockAiText, mockAiFailure } from './mocks/ai-runtime';

// ヘルパー: JWT 取得
async function loginAsUser(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: 'test@example.com', password: 'TestPassword123' });
  return res.body.accessToken ?? res.body.token ?? '';
}

// AiMessageSpread fixture: @turnContext (DialogTurn[] の JSON 文字列)
// Spec: step-03 messages[1] kind="spread", ref="@turnContext"
const turnContextFixture = JSON.stringify([
  { role: 'user', content: 'Hello, can you help me practice English?' },
  { role: 'assistant', content: 'Of course! I would be happy to help you practice English.' },
]);

describe('POST /api/el/sessions/:sessionId/turns (会話ターン進行 E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let accessToken: string;
  let aiRuntime: AiRuntimeService;
  let createdIds: { [table: string]: (number | string)[] } = {};

  // PLACEHOLDER: テスト用セッション ID (事前に learning_sessions を作成しておくこと)
  const validSessionId = 1;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }),
    );
    await app.init();

    const dbPath =
      process.env.DATABASE_URL ||
      `file:${require('path').resolve(__dirname, '../prisma/dev.db')}`;
    prisma = new PrismaClient({ datasources: { db: { url: dbPath } } });

    // AiRuntimeService の取得 (Phase 2-C 固定契約)
    aiRuntime = app.get(AiRuntimeService);

    accessToken = await loginAsUser(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    // turn_logs cleanup
    const turnIds = createdIds['turn_logs'] ?? [];
    if (turnIds.length > 0) {
      await prisma.turnLog.deleteMany({
        where: { id: { in: turnIds as number[] } },
      });
    }
    createdIds = {};
  });

  // ==========================================================================
  // P1/P2: 基本 E2E テスト (非 AI, mock mode)
  // ==========================================================================

  describe('POST /api/el/sessions/:sessionId/turns [mock mode]', () => {

    let aiRuntimeSpy: jest.SpyInstance | undefined;

    afterEach(() => {
      if (aiRuntimeSpy) {
        aiRuntimeSpy.mockRestore();
        aiRuntimeSpy = undefined;
      }
    });

    /**
     * Spec: ProcessFlow 96118ae1 act-001 step-07
     *   responseId="200-ok"
     *   outputs: aiResponseText (string), turnId (integer), aiAudioUrl (nullable)
     */
    it('#1 happy path: userInput 送信 → 200 + aiResponseText + turnId', async () => {
      // AI mock 設定 (step-03: aiCall)
      // Spec: ProcessFlow 96118ae1 act-001 step-03 [ai-mode:mock]
      aiRuntimeSpy = mockAiText(
        aiRuntime,
        "That's a great question! Let's practice some useful phrases.",
      );

      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${validSessionId}/turns`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          sessionId: validSessionId,
          userInput: 'Hello! I want to practice English today.',
          turnContext: turnContextFixture,
          generateAudio: false,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('aiResponseText');
      expect(typeof res.body.aiResponseText).toBe('string');
      expect(res.body).toHaveProperty('turnId');
      expect(typeof res.body.turnId).toBe('number');
      // aiAudioUrl は generateAudio=false → null
      expect(res.body.aiAudioUrl).toBeNull();

      createdIds['turn_logs'] = [...(createdIds['turn_logs'] ?? []), res.body.turnId];
    });

    // === Section 2: validation エラー系 ===

    /**
     * Spec: ProcessFlow 96118ae1 act-001 inputs[userInput]
     *   required=true → userInput 欠落 → 400
     */
    it('#2 validation: userInput 欠落 → 400', async () => {
      aiRuntimeSpy = mockAiText(aiRuntime, 'dummy response');

      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${validSessionId}/turns`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          sessionId: validSessionId,
          // userInput を省略
          generateAudio: false,
        });

      expect(res.status).toBe(400);
    });

    /**
     * Spec: ProcessFlow 96118ae1 act-001 inputs[sessionId]
     *   type=integer → sessionId が integer でない → 400
     */
    it('#3 validation: sessionId が integer でない → 400', async () => {
      aiRuntimeSpy = mockAiText(aiRuntime, 'dummy response');

      const res = await request(app.getHttpServer())
        .post('/api/el/sessions/invalid-session-id/turns')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          userInput: 'Hello!',
          generateAudio: false,
        });

      expect(res.status).toBe(400);
    });

    // === Section 3: auth エラー ===

    /**
     * Spec: ProcessFlow 96118ae1 act-001 httpRoute.auth="required"
     *   JWT なし → 401
     */
    it('#4 auth: JWT なし → 401', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${validSessionId}/turns`)
        .send({
          userInput: 'Hello!',
          generateAudio: false,
        });

      expect(res.status).toBe(401);
    });

    // === Section 4: DB 副作用確認 (P2) ===

    /**
     * Spec: ProcessFlow 96118ae1 act-001 step-05
     *   kind=dbAccess, operation=INSERT
     *   lineage.writes=[{tableId: 4e126323-..., physicalName: turn_logs}]
     *
     * INSERT 後に turn_logs の行数が 1 増加する
     */
    it('#5 DB 副作用: turn_logs テーブルに row が追加される', async () => {
      aiRuntimeSpy = mockAiText(
        aiRuntime,
        'Hello! Nice to meet you. Let me help you with English.',
      );

      const countBefore = await prisma.turnLog.count({
        where: { session_id: validSessionId },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${validSessionId}/turns`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          userInput: 'Good morning! Let me practice.',
          turnContext: turnContextFixture,
          generateAudio: false,
        });

      expect(res.status).toBe(200);
      const turnId = res.body.turnId;
      createdIds['turn_logs'] = [...(createdIds['turn_logs'] ?? []), turnId];

      const countAfter = await prisma.turnLog.count({
        where: { session_id: validSessionId },
      });
      expect(countAfter).toBe(countBefore + 1);
    });

    /**
     * Spec: ProcessFlow 96118ae1 act-001 step-04c + step-04d + step-05
     *   turn_number = COALESCE(MAX(turn_number), 0) + 1 (算出後 INSERT)
     *   DB の turn_logs.turn_number が 1 以上であること
     */
    it('#6 DB 副作用: turn_logs の turn_number が適切に設定される', async () => {
      aiRuntimeSpy = mockAiText(aiRuntime, 'Good morning! How can I help you today?');

      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${validSessionId}/turns`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          userInput: 'Can you explain present perfect tense?',
          turnContext: '[]',
          generateAudio: false,
        });

      expect(res.status).toBe(200);
      const turnId = res.body.turnId;
      createdIds['turn_logs'] = [...(createdIds['turn_logs'] ?? []), turnId];

      const row = await prisma.turnLog.findUnique({ where: { id: turnId } });
      expect(row).not.toBeNull();
      expect(row!.turn_number).toBeGreaterThanOrEqual(1);
    });

    // === Section 5: セッション存在確認 (step-01 + step-02) ===

    /**
     * Spec: ProcessFlow 96118ae1 act-001 step-01 + step-02
     *   learning_sessions で sessionId + user_id + status='in_progress' を確認
     *   → セッション存在しない場合: 404 (catalog.errors.SESSION_NOT_FOUND.httpStatus=404)
     */
    it('#7 セッション存在確認: 存在しない sessionId → 404', async () => {
      aiRuntimeSpy = mockAiText(aiRuntime, 'dummy response');

      const nonExistentSessionId = 999999999;
      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${nonExistentSessionId}/turns`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          userInput: 'Hello!',
          generateAudio: false,
        });

      // catalog.errors.SESSION_NOT_FOUND.httpStatus=404
      expect(res.status).toBe(404);
    });

    // ==========================================================================
    // P5: AI flow 固有テスト (4 観点)
    // ==========================================================================

    /**
     * AI-1: 業務フィルタ
     * responseFormat=text → compute step に @aiResponse.object.* filter なし → skip
     * Spec: ProcessFlow 96118ae1 step-03 responseFormat=text
     */
    it.skip('#AI-1 業務フィルタ: responseFormat=text のため skip (filter/map compute なし)', () => {});

    /**
     * AI-2: secret 未設定 → 503
     * Spec: ProcessFlow 96118ae1 step-03 [ai-mode:mock]
     *   modelRef=dialogModel → modelEndpoints.dialogModel.auth.tokenRef=@secret.anthropicApiKey
     *   secrets.anthropicApiKey.name=ANTHROPIC_API_KEY → env var
     */
    it('#AI-2 ANTHROPIC_API_KEY 未設定 → 503 Service Unavailable', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = '';

      try {
        const res = await request(app.getHttpServer())
          .post(`/api/el/sessions/${validSessionId}/turns`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            userInput: 'Hello!',
            turnContext: '[]',
            generateAudio: false,
          });

        // API key 未設定時は provider 呼び出し前に 503 を返す実装が前提
        // 実装が 401 / 500 を返す場合はその status に合わせてコメントを修正すること
        expect(res.status).toBe(503);
      } finally {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    /**
     * AI-3: response format violation
     * responseFormat=text → parse / schema 検証ステップが無い → skip
     * Spec: ProcessFlow 96118ae1 step-03 responseFormat=text (default)
     */
    it.skip('#AI-3 response format violation: responseFormat=text のため skip', () => {});

    /**
     * AI-4: provider 呼び出し失敗 → 502
     * Spec: ProcessFlow 96118ae1 act-001 step-03 [ai-mode:mock]
     *   outcomes.failure.action="abort" → catalog.errors.LLM_CALL_FAILED.responseId="502-llm-failed"
     *   action.responses["502-llm-failed"].status=502
     */
    it('#AI-4 provider 呼び出し失敗 → 502 (LLM_CALL_FAILED)', async () => {
      // Spec: ProcessFlow 96118ae1 act-001 step-03 [ai-mode:mock]
      aiRuntimeSpy = mockAiFailure(aiRuntime, new Error('Mock provider error: LLM unavailable'));

      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${validSessionId}/turns`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          userInput: 'Can you help me with grammar?',
          turnContext: turnContextFixture,
          generateAudio: false,
        });

      // catalog.errors.LLM_CALL_FAILED.httpStatus=502
      expect(res.status).toBe(502);
    });

    // === generateAudio=true のテスト ===

    /**
     * Spec: ProcessFlow 96118ae1 act-001 step-04 branch br-tts-on
     *   condition: @generateAudio == true → TTS 実行 → aiAudioUrl が非 null
     */
    it('#8 generateAudio=true の場合 aiAudioUrl が非 null', async () => {
      aiRuntimeSpy = mockAiText(
        aiRuntime,
        'Great question! Present perfect is used for recent past actions.',
      );

      const res = await request(app.getHttpServer())
        .post(`/api/el/sessions/${validSessionId}/turns`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          userInput: 'What is present perfect?',
          turnContext: '[]',
          generateAudio: true, // TTS 実行フラグ
        });

      expect(res.status).toBe(200);
      // generateAudio=true → aiAudioUrl は非 null かつ TTS URL 形式 (step-04 br-tts-on)
      // 本 dogfood は english-learning:TtsGenerate スタブで example.com TTS URL を返す
      expect(res.body.aiAudioUrl).not.toBeNull();
      expect(typeof res.body.aiAudioUrl).toBe('string');
      expect(res.body.aiAudioUrl).toMatch(/^https?:\/\/.+\.mp3$/);

      if (res.body.turnId) {
        createdIds['turn_logs'] = [...(createdIds['turn_logs'] ?? []), res.body.turnId];
      }
    });

  });

  // ==========================================================================
  // 実 API mode (CI default skip)
  // ==========================================================================
  (process.env.RUN_AI_INTEGRATION === '1' ? describe : describe.skip)(
    'POST /api/el/sessions/:sessionId/turns (会話ターン進行 E2E) [live API]',
    () => {

      /**
       * Spec: ProcessFlow 96118ae1 act-001 step-03 [ai-mode:live]
       *   AiRuntimeService.invoke を実際の Anthropic API で呼び出す
       *   必要 env var: ANTHROPIC_API_KEY
       *
       * 実行コマンド:
       *   RUN_AI_INTEGRATION=1 ANTHROPIC_API_KEY=<key> npx jest conversation-turn.e2e-spec.ts --runInBand
       */
      it('#live-1 happy path (実 API): AI 応答テキストが非空文字列で返る', async () => {
        const res = await request(app.getHttpServer())
          .post(`/api/el/sessions/${validSessionId}/turns`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            userInput: 'Hello! I am learning English.',
            turnContext: '[]',
            generateAudio: false,
          });

        expect(res.status).toBe(200);
        expect(typeof res.body.aiResponseText).toBe('string');
        expect(res.body.aiResponseText.length).toBeGreaterThan(0);
        // 非決定論的 assertion: AI 応答内容は assertion しない (英語文字が含まれることのみ確認)
        expect(res.body.aiResponseText).toMatch(/[a-zA-Z]/);

        if (res.body.turnId) {
          createdIds['turn_logs'] = [...(createdIds['turn_logs'] ?? []), res.body.turnId];
        }
      });

      /**
       * Spec: ProcessFlow 96118ae1 act-001 step-03 [ai-mode:live]
       *   AiMessageSpread (@turnContext) が正常に展開されて LLM に渡されること
       */
      it('#live-2 会話コンテキスト (AiMessageSpread) 付きターン → 文脈に即した応答', async () => {
        const contextWithHistory = JSON.stringify([
          { role: 'user', content: 'Can you teach me about verbs?' },
          { role: 'assistant', content: 'Of course! Verbs are action words. For example: run, eat, speak.' },
        ]);

        const res = await request(app.getHttpServer())
          .post(`/api/el/sessions/${validSessionId}/turns`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            userInput: 'Can you give me an example sentence with "speak"?',
            turnContext: contextWithHistory,
            generateAudio: false,
          });

        expect(res.status).toBe(200);
        expect(res.body.aiResponseText).toBeTruthy();

        if (res.body.turnId) {
          createdIds['turn_logs'] = [...(createdIds['turn_logs'] ?? []), res.body.turnId];
        }
      });

    },
  );

});
