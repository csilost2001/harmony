/**
 * E2E テスト: POST /api/ai/tag-suggest (AIタグ提案)
 *
 * // ===HARMONY_GENERATED_SECTION_START flowId=a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d actionId=act-001===
 * // このコメントブロックは /generate-tests スキル再実行時に overwrite される。
 * // anchor の外側 (人手追記 assertion) は保護される。
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * ProcessFlow: a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d (AIタグ提案)
 *
 * === spec → test mapping ===
 *
 * [inputs[].required=true: title, body]
 *   → Test: missing field → 400 VALIDATION_ERROR (P1)
 *
 * [httpRoute.auth="required"]
 *   → Test: Authorization ヘッダー無し → 401 (P1)
 *
 * [step step-03: kind=aiCall, modelRef="tagSuggestModel", responseFormat=structuredObject]
 *   → AI-1: 業務フィルタ — confidence < 0.6 を除外 / >= 0.6 を採用
 *           (compute step step-04 が @aiResponse.object.tags.filter(...) で適用)
 *   → AI-2: ANTHROPIC_API_KEY 未設定 → 503 Service Unavailable
 *   → AI-3: AI 応答が responseFormat 不適合 (structuredObject schema 違反) → 502
 *   → AI-4: provider 呼び出し失敗 → 502 (AI_API_ERROR、outcomes.failure.action=abort)
 *
 * [step step-04: kind=compute]
 *   → expression: @aiResponse.object.tags.filter(t => t.confidence >= @conv.limit.tagSuggestThreshold).map(...)
 *   → threshold = 0.6 (#859 解決後に @conv.limit.tagSuggestThreshold catalog 参照へ)
 *   → runtime が JSON parse 済 → user code は @<bind>.object.tags を直接参照 (旧 JSON.parse は廃止)
 *
 * === modelEndpoint 解決表 (project + flow merge 済) ===
 * step.modelRef = "tagSuggestModel"
 *   → modelEndpoints.tagSuggestModel = {
 *       provider: "anthropic",
 *       model: "claude-opus-4-7",
 *       auth: { kind: "bearer", tokenRef: "@secret.anthropicApiKey" },
 *       defaults: { temperature: 0.5, maxTokens: 512 }
 *     }
 *   (provider 切替は examples/diary/harmony/catalogs/external.json 編集だけで完結)
 *
 * === AI 参照解決表 ===
 * @secret.anthropicApiKey         → env var ANTHROPIC_API_KEY (secrets.anthropicApiKey.name より)
 * @conv.limit.tagSuggestThreshold → リテラル 0.6 (compute step step-04 より抽出)
 *   (#859 解決後: conventions catalog から解決)
 * AI model name → "claude-opus-4-7" (modelEndpoint.model)
 *
 * === 申し送り事項 ===
 * AI-MOCK-1: AiRuntimeService / 'invoke' は Phase 2-C 確定の固定契約。
 *            実装側は `/generate-code` 出力の <出力先>/src/ai/ai-runtime.service.ts。
 * AI-THRESH-1: threshold = 0.6 は step-04 expression のリテラル値。
 *              #859 解決後: @conv.limit.tagSuggestThreshold catalog 参照に置換すること。
 * AI-RETRY-1: SDK 内部の retry policy は modelEndpoint に未定義 (将来拡張候補)。
 *             Phase 2-B では AI-4 は単発失敗のみ assertion (retry 回数 assertion は AI-4-b で追加予定)。
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest'); // Spike L-5: require で import
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';
import {
  mockAiStructured,
  mockAiFailure,
  mockAiFormatViolation,
  type MockTagCandidate,
  type MockTagSuggestResult,
} from './mocks/ai-runtime';
import { AiRuntimeService } from '../src/ai/ai-runtime.service';

// ──────────────────────────────────────────────────────────────
// 定数 (PLACEHOLDER 解決済み or 手動置換が必要なもの)
// ──────────────────────────────────────────────────────────────

// TODO: seed.ts で作成されているテストユーザーの資格情報を確認すること
const ADMIN_USERNAME = 'testuser'; // PLACEHOLDER: apps/api/prisma/seed.ts を確認
const ADMIN_PASSWORD = 'password'; // PLACEHOLDER: 同上

// AI-1 threshold: step-04 expression よりリテラル抽出
// TODO: #859 解決後は @conv.limit.tagSuggestThreshold catalog 参照に変更すること
const AI_TAG_SUGGEST_THRESHOLD = 0.6;

// Phase 2-C 確定: AiRuntimeService は `/generate-code` で <出力先>/src/ai/ai-runtime.service.ts に
// 生成される。本テストは moduleFixture.get で DI コンテナから取得する。
let aiRuntime: AiRuntimeService;

// ──────────────────────────────────────────────────────────────
// ヘルパー関数
// ──────────────────────────────────────────────────────────────

/**
 * テストユーザーで JWT を取得する。
 * seed.ts で username=testuser / password=password が作成済み前提。
 */
async function loginAsTestUser(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  // PLACEHOLDER: JWT レスポンスキーを確認 (apps/api/src/auth/auth.service.ts)
  return res.body.accessToken;
}

// ──────────────────────────────────────────────────────────────
// テストスイート [mock mode]
// ──────────────────────────────────────────────────────────────

describe('POST /api/ai/tag-suggest (AIタグ提案 E2E) [mock mode]', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let accessToken: string;
  let aiRuntimeSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();

    // DATABASE_URL 絶対パス対応 (Spike L-6)
    const dbPath =
      process.env.DATABASE_URL ||
      `file:${require('path').resolve(__dirname, '../prisma/dev.db')}`;
    prisma = new PrismaClient({ datasources: { db: { url: dbPath } } });

    // Phase 2-C 確定: 実 AiRuntimeService を DI コンテナから取得
    aiRuntime = moduleFixture.get<AiRuntimeService>(AiRuntimeService);

    // JWT 取得
    accessToken = await loginAsTestUser(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(() => {
    if (aiRuntimeSpy) {
      aiRuntimeSpy.mockRestore();
      aiRuntimeSpy = undefined;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // P1: 基本テスト (validation / auth)
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-01
   *   validation rule: field=title, type=required
   */
  it('#1 validation: title 欠落 → 400 VALIDATION_ERROR', async () => {
    // step-01 (validation) で 400 を返すため AI step (step-03) は呼ばれない → mock 不要
    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ body: 'テスト本文' });

    expect(res.status).toBe(400);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-01
   *   validation rule: field=body, type=required
   */
  it('#2 validation: body 欠落 → 400 VALIDATION_ERROR', async () => {
    // step-01 (validation) で 400 を返すため AI step (step-03) は呼ばれない → mock 不要
    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'テストタイトル' });

    expect(res.status).toBe(400);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d
   *   httpRoute.auth="required"
   */
  it('#3 auth: JWT なし → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .send({ title: 'テストタイトル', body: 'テスト本文' });

    expect(res.status).toBe(401);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *   happy path: 全フィールド指定で 200 + candidates を返す
   */
  it('#4 happy path: title + body 指定で 200 + candidates 返却', async () => {
    aiRuntimeSpy = mockAiStructured(aiRuntime, {
      tags: [
        { slug: 'cooking', name: '料理', confidence: 0.9 },
        { slug: 'recipe', name: 'レシピ', confidence: 0.8 },
      ],
    } as MockTagSuggestResult);

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '簡単パスタの作り方', body: '今日は簡単なパスタを作りました。' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('candidates');
    expect(Array.isArray(res.body.candidates)).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // AI flow テスト [mock mode]
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *        step:step-04 kind=compute (threshold filter) [ai-mode:mock]
   *
   * AI-1-a: threshold (0.6) 未満のタグは candidates から除外される
   *
   * compute step step-04 expression:
   *   @aiResponse.object.tags.filter(t => t.confidence >= @conv.limit.tagSuggestThreshold)...
   * → mock の object.tags に schema (TagSuggestResult) 準拠の境界値 fixture を渡す。
   * → runtime は JSON parse 済 → user code は @aiResponse.object.tags を直接参照 (旧 JSON.parse は廃止)。
   */
  it(`#5 AI-1: confidence < ${AI_TAG_SUGGEST_THRESHOLD} のタグは candidates から除外される`, async () => {
    aiRuntimeSpy = mockAiStructured(aiRuntime, {
      tags: [
        { slug: 'high-confidence', name: '高信頼度タグ', confidence: 0.9 },
        { slug: 'below-threshold', name: '閾値未満タグ', confidence: 0.5 },
        { slug: 'exact-threshold', name: '閾値ちょうどタグ', confidence: AI_TAG_SUGGEST_THRESHOLD },
      ],
    } as MockTagSuggestResult);

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '信頼度テスト', body: 'フィルタ動作確認用テストデータ。' });

    expect(res.status).toBe(200);
    const candidates = res.body.candidates as MockTagCandidate[];

    // threshold 未満 (0.5) は除外されること
    expect(candidates.find((c) => c.slug === 'below-threshold')).toBeUndefined();

    // threshold 以上 (0.9) は含まれること
    expect(candidates.find((c) => c.slug === 'high-confidence')).toBeDefined();

    // 閾値ちょうど (0.6) は含まれること (境界値 OK)
    expect(candidates.find((c) => c.slug === 'exact-threshold')).toBeDefined();
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *
   * AI-1-b: 全タグが threshold 未満の場合 → candidates = [] (空配列)
   */
  it(`#6 AI-1: 全タグが confidence < ${AI_TAG_SUGGEST_THRESHOLD} → candidates = []`, async () => {
    aiRuntimeSpy = mockAiStructured(aiRuntime, {
      tags: [
        { slug: 'low-1', name: '低信頼度1', confidence: 0.1 },
        { slug: 'low-2', name: '低信頼度2', confidence: 0.3 },
        { slug: 'low-3', name: '低信頼度3', confidence: 0.59 },
      ],
    } as MockTagSuggestResult);

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '全低信頼度テスト', body: '全タグが閾値未満のテストデータ。' });

    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(0);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *
   * AI-2: ANTHROPIC_API_KEY 未設定 → 503 Service Unavailable
   *
   * modelEndpoint.auth.tokenRef = "@secret.anthropicApiKey"
   *   → secrets.anthropicApiKey.name = "ANTHROPIC_API_KEY" (project level catalog)
   * API key 未設定時は provider 呼び出し前に 503 を返す設計が前提。
   *
   * NOTE: 実装が 401 / 500 を返す場合はその status に合わせて変更すること。
   */
  it('#7 AI-2: ANTHROPIC_API_KEY="" (未設定) → 503 Service Unavailable', async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = '';

    try {
      const res = await request(app.getHttpServer())
        .post('/api/ai/tag-suggest')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'APIキーテスト', body: 'APIキー未設定時の動作確認。' });

      expect(res.status).toBe(503);
    } finally {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *
   * AI-3: AI 応答が responseFormat=structuredObject 不適合 → 502 (provider violation)
   *
   * runtime が schema 検証で失敗するケース。mock では検証失敗の例外を直接 throw する想定。
   * 実装が 500 を返す場合はその status に合わせて変更すること。
   */
  it('#8 AI-3: AI 応答が responseFormat 不適合 (structuredObject) → 502', async () => {
    aiRuntimeSpy = mockAiFormatViolation(aiRuntime);

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '形式違反テスト', body: 'schema 違反応答時の動作確認。' });

    expect(res.status).toBe(502);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *
   * AI-4: provider 呼び出し失敗 → 502 (AI_API_ERROR、outcomes.failure.action=abort)
   *
   * step.outcomes.failure = { action: "abort", description: "AI モデル呼び出し失敗時は 502 を返す。" }
   *   → action.responses[id="502-ai-error"].status = 502
   *
   * NOTE: SDK 内部の retry policy は Phase 2-C で確定。Phase 2-B は単発失敗のみ assertion。
   */
  it('#9 AI-4: provider 呼び出し失敗 → 502 (AI_API_ERROR)', async () => {
    aiRuntimeSpy = mockAiFailure(aiRuntime);

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'プロバイダ失敗テスト', body: 'provider 呼び出し失敗時の動作確認。' });

    expect(res.status).toBe(502);
  });
});

// ──────────────────────────────────────────────────────────────
// AI flow テスト [live API mode — CI skip]
// ──────────────────────────────────────────────────────────────

/**
 * 実 API mode: RUN_AI_INTEGRATION=1 の場合のみ実行。
 * CI では skip (default)。手動 smoke 時のみ:
 *   RUN_AI_INTEGRATION=1 ANTHROPIC_API_KEY=<key> npx jest ai-tag-suggest.e2e-spec.ts --runInBand
 *
 * 注意: 実際の anthropic API (claude-opus-4-7) を叩くため、API コストが発生する。
 *       1 テストあたり最大 512 tokens 消費 (modelEndpoint.defaults.maxTokens より)。
 *
 * NOTE: `describe.skipIf` は Vitest 専用 API。jest では TypeError になるため
 *       ternary パターン (jest + vitest 両互換) を使用する。
 */
(process.env.RUN_AI_INTEGRATION === '1' ? describe : describe.skip)(
  'POST /api/ai/tag-suggest (AIタグ提案 E2E) [live API — CI skip]',
  () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let accessToken: string;

    beforeAll(async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          '[live API] ANTHROPIC_API_KEY が設定されていません。\n' +
            'RUN_AI_INTEGRATION=1 ANTHROPIC_API_KEY=<key> npx jest ai-tag-suggest.e2e-spec.ts --runInBand で実行してください。',
        );
      }

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
      accessToken = await loginAsTestUser(app);
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    /**
     * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:live]
     * AI-5: 実 anthropic API — happy path、basic な candidates 取得
     */
    it(
      '#10 [live] happy path: 実 anthropic API で candidates が返り、全て threshold 以上',
      async () => {
        const res = await request(app.getHttpServer())
          .post('/api/ai/tag-suggest')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            title: '自家製ラーメンを作った',
            body: '週末に自家製ラーメンを作りました。スープは豚骨ベースで8時間煮込み、麺は市販の生麺を使いました。',
          });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('candidates');
        expect(Array.isArray(res.body.candidates)).toBe(true);

        // 信頼度フィルタが適用されていること (全候補が >= threshold)
        for (const c of res.body.candidates as MockTagCandidate[]) {
          expect(c.confidence).toBeGreaterThanOrEqual(AI_TAG_SUGGEST_THRESHOLD);
          expect(c).toHaveProperty('slug');
          expect(c).toHaveProperty('name');
          expect(typeof c.slug).toBe('string');
          expect(typeof c.name).toBe('string');
        }
      },
      60_000,
    );

    /**
     * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:live]
     *        step:step-04 kind=compute [ai-mode:live]
     *
     * AI-6: 実 API — isNew フィールドが付与されること
     * step-04 expression: !@allTagSlugs.some(s => s.slug === t.slug)
     */
    it(
      '#11 [live] 実 API: candidates に isNew フィールドが付与される',
      async () => {
        const res = await request(app.getHttpServer())
          .post('/api/ai/tag-suggest')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            title: '読書記録: 坊っちゃん',
            body: '夏目漱石の坊っちゃんを読みました。痛快な主人公の性格が好きでした。',
          });

        expect(res.status).toBe(200);
        const candidates = res.body.candidates as Array<MockTagCandidate & { isNew: boolean }>;

        if (candidates.length > 0) {
          expect(typeof candidates[0].isNew).toBe('boolean');
        }
      },
      60_000,
    );
  },
);
