// helpers/db.ts
//
// DB ヘルパー — Playwright E2E テスト用 Prisma seed / truncate
//
// PLACEHOLDER 解決表:
//   <DATABASE_URL>  : file:./prisma/dev.db  (diary アプリの SQLite パス)
//   Prisma model 名 : post, postTag, photo, tag, user
//   削除順          : postTag → photo → post → tag → user (FK 依存の逆順)
//
// 注意: D-7 (SQLite --workers=1) に従い、このヘルパーは並列実行を想定しない。
//       各テストは beforeEach で seed、afterEach で truncate する。

import { PrismaClient } from '@prisma/client';
import * as path from 'path';

// DATABASE_URL 絶対パス対応 (Spike L-6 知見)
const dbUrl =
  process.env.DATABASE_URL ??
  `file:${path.resolve(process.cwd(), 'prisma/dev.db')}`;

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

export interface SeedUser {
  username: string;
  email: string;
  /** bcrypt ハッシュ化済みパスワードを渡すこと */
  passwordHash: string;
  role?: 'user' | 'admin';
}

export interface SeedPost {
  title: string;
  body: string;
  status?: 'draft' | 'published';
  authorUsername: string;
}

export interface SeedOptions {
  users?: SeedUser[];
  posts?: SeedPost[];
}

const DEFAULT_USERS: SeedUser[] = [
  {
    username: 'testuser',
    email: 'testuser@example.com',
    // PLACEHOLDER: bcrypt.hashSync('password', 10) の値を設定
    passwordHash: '$2b$10$PLACEHOLDER_HASH',
    role: 'user',
  },
  {
    username: 'admin',
    email: 'admin@example.com',
    // PLACEHOLDER: bcrypt.hashSync('diary-admin', 10) の値を設定
    passwordHash: '$2b$10$PLACEHOLDER_ADMIN_HASH',
    role: 'admin',
  },
];

/**
 * テストデータ seed
 * beforeEach / beforeAll で呼び出す
 *
 * PLACEHOLDER: diary アプリの Prisma スキーマに合わせた upsert ロジックに変更すること。
 */
export async function seedTestData(options: SeedOptions = {}): Promise<void> {
  const users = options.users ?? DEFAULT_USERS;

  for (const user of users) {
    // PLACEHOLDER: User モデルのフィールド名を確認して調整
    await prisma.user.upsert({
      where: { username: user.username },
      update: {},
      create: {
        username: user.username,
        email: user.email,
        password: user.passwordHash,  // PLACEHOLDER: フィールド名が "password" か "passwordHash" か確認
        role: user.role ?? 'user',
      },
    });
  }

  // posts の seed (指定された場合のみ)
  if (options.posts) {
    for (const post of options.posts) {
      // PLACEHOLDER: Post モデルのフィールド名を確認して調整
      await prisma.post.create({
        data: {
          title: post.title,
          body: post.body,
          status: post.status ?? 'draft',
          author: {
            connect: { username: post.authorUsername },
          },
        },
      });
    }
  }
}

/**
 * テストデータ truncate
 * afterEach / afterAll で呼び出す
 *
 * 削除順序: FK 依存の逆順 (child → parent)
 *   postTag → photo → post → tag → user
 *
 * PLACEHOLDER: テーブル定義の FK 構造に合わせて削除順序を調整すること。
 */
export async function truncateTestData(): Promise<void> {
  // FK 依存の逆順で削除
  await prisma.postTag.deleteMany({});   // 中間テーブルを先に削除
  await prisma.photo.deleteMany({});     // 写真 (post FK)
  await prisma.post.deleteMany({});      // 投稿
  await prisma.tag.deleteMany({});       // タグ (post_tags 削除後)
  await prisma.user.deleteMany({});      // ユーザー (最後)
}

/**
 * 特定投稿の削除 (test 内 cleanup 用)
 */
export async function deletePost(postId: number | string): Promise<void> {
  const id = typeof postId === 'string' ? parseInt(postId, 10) : postId;
  // 子テーブルを先に削除
  await prisma.postTag.deleteMany({ where: { postId: id } });
  await prisma.photo.deleteMany({ where: { postId: id } });
  await prisma.post.delete({ where: { id } });
}

export { prisma };
