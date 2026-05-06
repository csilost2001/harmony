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
 * [step step-03: kind=externalSystem, systemRef="claudeApi"]
 *   → AI-1: 信頼度フィルタ — threshold 未満 (< 0.6) を除外 / >= 0.6 を採用
 *   → AI-2: API key 未設定 (CLAUDE_API_KEY="") → 503 Service Unavailable
 *   → AI-3: malformed JSON レスポンス → 500 Internal Server Error
 *   → AI-4: 502 エラー × 2 回 → spy 2 回呼出 → 最終 502 (AI_API_ERROR)
 *
 * [step step-04: kind=compute]
 *   → JSON.parse(@aiResponse.content[0].text).filter(t => t.confidence >= 0.6)
 *   → threshold = 0.6 (リテラル、#859 解決後に conventions.ai.tagSuggestThreshold へ)
 *
 * === AI 参照解決表 ===
 * @env.CLAUDE_API_BASE_URL   → PLACEHOLDER: "https://api.anthropic.com"
 *   (#859 解決後: harmony.json context.envCatalog から解決)
 * @secret.claudeApiKey       → env var CLAUDE_API_KEY
 * @conv.ai.tagSuggestThreshold → リテラル 0.6 (compute step より抽出)
 *   (#859 解決後: conventions catalog から解決)
 * AI model name → リテラル 'claude-opus-4-7'
 *   (#859 解決後: @conv.ai.tagSuggestModel から解決)
 *
 * === 申し送り事項 ===
 * AI-MOCK-1: jest.spyOn(httpService, 'post') を使用。
 *             #865 (AI provider 抽象化) 解決後: provider interface mock に置換すること。
 * AI-THRESH-1: threshold = 0.6 は step-04 expression のリテラル値。
 *               #859 解決後: conventions.ai.tagSuggestThreshold catalog 参照に置換すること。
 * AI-MODEL-1: model = 'claude-opus-4-7' は step-03 httpCall.body のリテラル。
 *              #859 解決後: @conv.ai.tagSuggestModel catalog 参照に置換すること。
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest'); // Spike L-5: require で import
import { HttpService } from '@nestjs/axios';
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';
import {
  mockClaudeApiSuccess,
  mockClaudeApiError,
  mockClaudeApiBadJson,
  type MockClaudeTagCandidate,
} from './mocks/claude-api';

// ──────────────────────────────────────────────────────────────
// 定数 (PLACEHOLDER 解決済み or 手動置換が必要なもの)
// ──────────────────────────────────────────────────────────────

// TODO: seed.ts で作成されているテストユーザーの資格情報を確認すること
const ADMIN_USERNAME = 'testuser'; // PLACEHOLDER: apps/api/prisma/seed.ts を確認
const ADMIN_PASSWORD = 'password'; // PLACEHOLDER: 同上

// AI-1 threshold: step-04 expression よりリテラル抽出
// TODO: #859 解決後は conventions.ai.tagSuggestThreshold catalog 参照に変更すること
const AI_TAG_SUGGEST_THRESHOLD = 0.6;

// retryPolicy: a9b0c1d2 ProcessFlow の externalSystems.claudeApi より
const RETRY_MAX_ATTEMPTS = 2;

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
// テストスイート
// ──────────────────────────────────────────────────────────────

describe('POST /api/ai/tag-suggest (AIタグ提案 E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let httpService: HttpService;
  let accessToken: string;
  let httpServiceSpy: jest.SpyInstance | undefined;

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

    // HttpService を DI コンテナから取得 (mock target)
    // TODO: HttpService が別モジュールに属する場合は適切なモジュールから取得すること
    httpService = moduleFixture.get<HttpService>(HttpService);

    // JWT 取得
    accessToken = await loginAsTestUser(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(() => {
    // spy の restore (必ずここで実行)
    if (httpServiceSpy) {
      httpServiceSpy.mockRestore();
      httpServiceSpy = undefined;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // P1: 基本テスト (validation / auth)
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d act-001 step-01 validation rule
   *   field=title, type=required
   */
  it('#1 validation: title 欠落 → 400 VALIDATION_ERROR', async () => {
    // mock を設定しておく (validation で弾かれるため呼ばれないはずだが念のため)
    httpServiceSpy = mockClaudeApiSuccess(httpService, '[]');

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ body: 'テスト本文' });

    expect(res.status).toBe(400);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d act-001 step-01 validation rule
   *   field=body, type=required
   */
  it('#2 validation: body 欠落 → 400 VALIDATION_ERROR', async () => {
    httpServiceSpy = mockClaudeApiSuccess(httpService, '[]');

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'テストタイトル' });

    expect(res.status).toBe(400);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d act-001
   *   httpRoute.auth="required"
   */
  it('#3 auth: JWT なし → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .send({ title: 'テストタイトル', body: 'テスト本文' });

    expect(res.status).toBe(401);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d act-001 step-03 [ai-mode:mock]
   *   happy path: 全フィールド指定で 200 + candidates を返す
   */
  it('#4 happy path: title + body 指定で 200 + candidates 返却', async () => {
    const mockTags: MockClaudeTagCandidate[] = [
      { slug: 'cooking', name: '料理', confidence: 0.9 },
      { slug: 'recipe', name: 'レシピ', confidence: 0.8 },
    ];
    httpServiceSpy = mockClaudeApiSuccess(httpService, JSON.stringify(mockTags));

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
   * threshold: 0.6 (step-04 expression リテラル)
   * TODO: #859 解決後に conventions.ai.tagSuggestThreshold catalog 参照へ変更
   */
  it(`#5 AI-1: confidence < ${AI_TAG_SUGGEST_THRESHOLD} のタグは candidates から除外される`, async () => {
    const mockTags: MockClaudeTagCandidate[] = [
      { slug: 'high-confidence', name: '高信頼度タグ', confidence: 0.9 },
      { slug: 'below-threshold', name: '閾値未満タグ', confidence: 0.5 },
      { slug: 'exact-threshold', name: '閾値ちょうどタグ', confidence: AI_TAG_SUGGEST_THRESHOLD },
    ];

    httpServiceSpy = mockClaudeApiSuccess(
      httpService,
      JSON.stringify(mockTags),
    );

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '信頼度テスト', body: 'フィルタ動作確認用テストデータ。' });

    expect(res.status).toBe(200);
    const candidates = res.body.candidates as MockClaudeTagCandidate[];

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
    const mockTags: MockClaudeTagCandidate[] = [
      { slug: 'low-1', name: '低信頼度1', confidence: 0.1 },
      { slug: 'low-2', name: '低信頼度2', confidence: 0.3 },
      { slug: 'low-3', name: '低信頼度3', confidence: 0.59 },
    ];

    httpServiceSpy = mockClaudeApiSuccess(
      httpService,
      JSON.stringify(mockTags),
    );

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
   * AI-2: CLAUDE_API_KEY 未設定 → 503 Service Unavailable
   *
   * secrets catalog: claudeApiKey → env var CLAUDE_API_KEY
   * API key 未設定時は provider 呼び出し前に 503 を返す設計が前提。
   *
   * NOTE: 実装が 401 / 500 を返す場合はその status に合わせて変更すること。
   *       アプリ側の実装 (apps/api/src/ai/tag-suggest.service.ts 等) を確認すること。
   */
  it('#7 AI-2: CLAUDE_API_KEY="" (未設定) → 503 Service Unavailable', async () => {
    const originalApiKey = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = '';

    try {
      const res = await request(app.getHttpServer())
        .post('/api/ai/tag-suggest')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'APIキーテスト', body: 'APIキー未設定時の動作確認。' });

      // API key 未設定時は 503 を期待
      // TODO: 実装が 401/500 を返す場合はここを修正すること
      expect(res.status).toBe(503);
    } finally {
      // env var を必ず restore
      process.env.CLAUDE_API_KEY = originalApiKey;
    }
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *        step:step-04 kind=compute (JSON.parse) [ai-mode:mock]
   *
   * AI-3: AI レスポンス JSON parse 失敗 (malformed JSON) → 500 Internal Server Error
   *
   * step-04 expression: JSON.parse(@aiResponse.content[0].text).filter(...)
   * → content[0].text が "NOT_VALID_JSON_RESPONSE {{broken}}" → SyntaxError → 500
   */
  it('#8 AI-3: AI レスポンス JSON parse 失敗 (malformed JSON) → 500', async () => {
    httpServiceSpy = mockClaudeApiBadJson(httpService);

    const res = await request(app.getHttpServer())
      .post('/api/ai/tag-suggest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'JSONパースエラーテスト', body: '不正なJSONを返す場合のテスト。' });

    expect(res.status).toBe(500);
  });

  /**
   * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:mock]
   *
   * AI-4: AI API 502 エラー → retryPolicy.maxAttempts=2 回 retry → spy 2 回呼出 → 最終 502
   *
   * retryPolicy: { maxAttempts: 2, backoff: "exponential", initialDelayMs: 1000 }
   * → spy が 2 回呼ばれること (jest.useFakeTimers で delay をスキップ)
   * → 最終的に 502 (AI_API_ERROR) が返ること
   *
   * NOTE: retry 実装の前提 — NestJS サービス層で retryPolicy を honor した retry ロジックが
   *       実装されていること。未実装の場合は spy 呼出回数が 1 回になる。
   *       spy.toHaveBeenCalledTimes(1) になる場合、retry 未実装として申し送りとする。
   */
  it(`#9 AI-4: AI API 502 エラー × ${RETRY_MAX_ATTEMPTS} 回 → spy ${RETRY_MAX_ATTEMPTS} 回呼出 → 最終 502 (AI_API_ERROR)`, async () => {
    // FakeTimers で retry delay (exponential backoff) をスキップ
    jest.useFakeTimers();

    httpServiceSpy = mockClaudeApiError(httpService, 502, RETRY_MAX_ATTEMPTS);

    let res: any;
    try {
      const resPromise = request(app.getHttpServer())
        .post('/api/ai/tag-suggest')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'リトライテスト', body: '502エラーのリトライポリシー動作確認。' });

      // 全 exponential delay をスキップ (initialDelayMs=1000, 2回分)
      await jest.runAllTimersAsync();
      res = await resPromise;
    } finally {
      jest.useRealTimers();
    }

    // 最終的に 502 AI_API_ERROR が返ること
    expect(res.status).toBe(502);

    // retry が maxAttempts (=2) 回実行されていること
    // NOTE: retry 未実装の場合は 1 回になる → その場合は申し送り事項 AI-MOCK-1 を参照
    expect(httpServiceSpy).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS);
  });
});

// ──────────────────────────────────────────────────────────────
// AI flow テスト [live API mode — CI skip]
// ──────────────────────────────────────────────────────────────

/**
 * 実 API mode: RUN_AI_INTEGRATION=1 の場合のみ実行。
 * CI では skip (default)。手動 smoke 時のみ:
 *   RUN_AI_INTEGRATION=1 CLAUDE_API_KEY=<key> npx jest ai-tag-suggest.e2e-spec.ts --runInBand
 *
 * 注意: 実際の Claude API を叩くため、API コストが発生する。
 *       1 テストあたり最大 512 tokens 消費 (step-03 httpCall.body の max_tokens より)。
 */
describe.skipIf(process.env.RUN_AI_INTEGRATION !== '1')(
  'POST /api/ai/tag-suggest (AIタグ提案 E2E) [live API — CI skip]',
  () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let accessToken: string;

    beforeAll(async () => {
      // API key チェック
      if (!process.env.CLAUDE_API_KEY) {
        throw new Error(
          '[live API] CLAUDE_API_KEY が設定されていません。\n' +
            'RUN_AI_INTEGRATION=1 CLAUDE_API_KEY=<key> npx jest ai-tag-suggest.e2e-spec.ts --runInBand で実行してください。',
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
     *
     * AI-5: 実 Claude API — happy path、基本的なタグ候補取得
     * 実 API レスポンスは非決定論的なため、構造のみ確認する。
     */
    it(
      '#10 [live] happy path: 実 Claude API で candidates が返り、全て threshold 以上',
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
        // TODO: #859 解決後に AI_TAG_SUGGEST_THRESHOLD を catalog 参照から取得
        for (const c of res.body.candidates as MockClaudeTagCandidate[]) {
          expect(c.confidence).toBeGreaterThanOrEqual(AI_TAG_SUGGEST_THRESHOLD);
          expect(c).toHaveProperty('slug');
          expect(c).toHaveProperty('name');
          expect(typeof c.slug).toBe('string');
          expect(typeof c.name).toBe('string');
        }
      },
      60_000, // 実 API は 60s タイムアウト
    );

    /**
     * Spec: ProcessFlow a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d step:step-03 [ai-mode:live]
     *        step:step-04 kind=compute [ai-mode:live]
     *
     * AI-6: 実 API — isNew フィールドが付与されること
     * step-04 の expression: !@allTagSlugs.some(s => s.slug === t.slug)
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
        const candidates = res.body.candidates as Array<
          MockClaudeTagCandidate & { isNew: boolean }
        >;

        // 候補があれば isNew フィールドを確認
        if (candidates.length > 0) {
          expect(typeof candidates[0].isNew).toBe('boolean');
        }
      },
      60_000,
    );
  },
);
