/**
 * E2E テスト: POST /api/el/sessions (学習セッション開始)
 *
 * // ===HARMONY_GENERATED_SECTION_START flowId=cc173367-d92a-4525-acc9-689bad9a048e actionId=act-001===
 *
 * ProcessFlow: cc173367-d92a-4525-acc9-689bad9a048e (学習セッション開始)
 *
 * === spec → test mapping ===
 * - step-01: stories SELECT (validate: is_active=TRUE) → 対象外ストーリーでの 4xx 確認
 * - step-02: learning_sessions INSERT → DB 行追加 assertion (lineage.writes)
 * - step-03: return 201 → sessionId 返却 assertion
 * - httpRoute.auth="required" → JWT なし 401 テスト
 * - inputs[storyId, required=true] → 欠落 400 テスト
 * - outputs[sessionId: integer] → response.body assertion
 * - responses[201-created] → status 201 + body schema assertion
 *
 * // ===HARMONY_GENERATED_SECTION_END===
 */

// Spec anchor: Flow cc173367-d92a-4525-acc9-689bad9a048e act-001

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest'); // Spike L-5: require で import
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';

// ヘルパー: JWT 取得 (PLACEHOLDER: /api/auth/login エンドポイントを確認すること)
async function loginAsUser(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: 'test@example.com', password: 'TestPassword123' });
  return res.body.accessToken ?? res.body.token ?? '';
}

describe('POST /api/el/sessions (学習セッション開始 E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let accessToken: string;
  let createdIds: { [table: string]: (number | string)[] } = {};

  // PLACEHOLDER: シード用ストーリーID。実際の DB データに合わせること
  const validStoryId = 1;

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

    accessToken = await loginAsUser(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    // 作成された learning_sessions を cleanup
    const sessionIds = createdIds['learning_sessions'] ?? [];
    if (sessionIds.length > 0) {
      await prisma.learningSession.deleteMany({
        where: { id: { in: sessionIds as number[] } },
      });
    }
    createdIds = {};
  });

  // === Section 1: happy path ===

  /**
   * Spec: ProcessFlow cc173367-d92a-4525-acc9-689bad9a048e act-001 step-03
   *   responseId="201-created", outputs[sessionId: integer]
   */
  it('#1 happy path: storyId 指定 → 201 + sessionId 返却', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/el/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storyId: validStoryId });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('sessionId');
    expect(typeof res.body.sessionId).toBe('number');

    createdIds['learning_sessions'] = [
      ...(createdIds['learning_sessions'] ?? []),
      res.body.sessionId,
    ];
  });

  // === Section 2: validation エラー系 ===

  /**
   * Spec: ProcessFlow cc173367-d92a-4525-acc9-689bad9a048e act-001 inputs[storyId]
   *   required=true → storyId 欠落 → 400
   */
  it('#2 validation: storyId 欠落 → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/el/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  /**
   * Spec: ProcessFlow cc173367-d92a-4525-acc9-689bad9a048e act-001 inputs[storyId]
   *   type=integer → 文字列を渡すと validation エラー
   */
  it('#3 validation: storyId が integer でない → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/el/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storyId: 'invalid-story-id' });

    expect(res.status).toBe(400);
  });

  // === Section 3: auth エラー ===

  /**
   * Spec: ProcessFlow cc173367-d92a-4525-acc9-689bad9a048e act-001 httpRoute.auth="required"
   *   JWT なし → 401
   */
  it('#4 auth: JWT なし → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/el/sessions')
      .send({ storyId: validStoryId });

    expect(res.status).toBe(401);
  });

  // === Section 4: DB 副作用確認 (P2) ===

  /**
   * Spec: ProcessFlow cc173367-d92a-4525-acc9-689bad9a048e act-001 step-02
   *   kind=dbAccess, operation=INSERT
   *   lineage.writes=[{tableId: d524cba6-..., physicalName: learning_sessions}]
   *
   * INSERT 後に learning_sessions の行数が 1 増加する
   */
  it('#5 DB 副作用: learning_sessions テーブルに row が追加される', async () => {
    const countBefore = await prisma.learningSession.count({
      where: { story_id: validStoryId },
    });

    const res = await request(app.getHttpServer())
      .post('/api/el/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storyId: validStoryId });

    expect(res.status).toBe(201);
    const sessionId = res.body.sessionId;
    createdIds['learning_sessions'] = [
      ...(createdIds['learning_sessions'] ?? []),
      sessionId,
    ];

    const countAfter = await prisma.learningSession.count({
      where: { story_id: validStoryId },
    });
    expect(countAfter).toBe(countBefore + 1);
  });

  /**
   * Spec: ProcessFlow cc173367-d92a-4525-acc9-689bad9a048e act-001 step-02
   *   operation=INSERT → learning_sessions に正しいフィールドで row が作成される
   *   status='in_progress', user_id=<sessionUserId>, story_id=<storyId>
   */
  it('#6 DB 副作用: learning_sessions の row に status=in_progress が設定される', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/el/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storyId: validStoryId });

    expect(res.status).toBe(201);
    const sessionId = res.body.sessionId;
    createdIds['learning_sessions'] = [
      ...(createdIds['learning_sessions'] ?? []),
      sessionId,
    ];

    // Prisma で直接確認
    const row = await prisma.learningSession.findUnique({ where: { id: sessionId } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('in_progress');
    expect(row!.story_id).toBe(validStoryId);
  });

  /**
   * Spec: ProcessFlow cc173367-d92a-4525-acc9-689bad9a048e act-001 step-01
   *   kind=dbAccess, operation=SELECT, lineage.reads=[{tableId: b5aa3e1b-..., purpose: validate}]
   *   stories テーブルから is_active=TRUE のみ学習開始可能
   *   → 存在しないストーリーID では 4xx
   */
  it('#7 stories バリデーション: 存在しないストーリーID → 4xx', async () => {
    const nonExistentStoryId = 999999999;
    const res = await request(app.getHttpServer())
      .post('/api/el/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ storyId: nonExistentStoryId });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
