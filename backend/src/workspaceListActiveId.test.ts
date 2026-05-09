/**
 * workspace.list active.id 解決テスト (#956)
 *
 * `workspace.list` WS ハンドラおよび `designer__workspace_list` MCP ツールが
 * `active.id` を正しく返すことを recentStore + findByPath レイヤーで検証する。
 *
 * wsBridge/index.ts の HTTP/WS サーバは起動せず、recentStore.findByPath を直接呼んで
 * "ハンドラが findByPath を使った場合の期待値" を検証する方式。
 *
 * 真因: raw 文字列等価 (`w.path === activePath`) は path 正規化差で find 失敗 →
 *       findByPath(activePath) の normalizePath 経由比較で解消される。
 */
import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP_DIR = path.join(os.tmpdir(), `harmony-ws-list-test-${process.pid}-${Date.now()}`);
const TMP_FILE = path.join(TMP_DIR, "recent-workspaces.json");
const ORIGINAL_ENV = process.env.DESIGNER_RECENT_FILE;

// 環境変数を設定してから recentStore を import (関数経由で都度読まれるため import 順は問わないが明示)
process.env.DESIGNER_RECENT_FILE = TMP_FILE;

const {
  upsertWorkspace,
  findByPath,
  listWorkspaces,
} = await import("./recentStore.js");

beforeAll(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
});

beforeEach(async () => {
  try {
    await fs.unlink(TMP_FILE);
  } catch { /* not found is OK */ }
});

afterAll(async () => {
  try {
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
  if (ORIGINAL_ENV !== undefined) {
    process.env.DESIGNER_RECENT_FILE = ORIGINAL_ENV;
  } else {
    delete process.env.DESIGNER_RECENT_FILE;
  }
});

describe("workspace.list active.id 解決 (#956)", () => {
  it("正常系: findByPath(activePath) で active.id が取得できる", async () => {
    // workspace を事前登録
    const entry = await upsertWorkspace("/tmp/ws-test-956", "テストWS");
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);

    // workspace.list ハンドラの処理: findByPath で activeEntry を解決
    const activePath = entry.path; // path.resolve("/tmp/ws-test-956")
    const activeEntry = await findByPath(activePath);

    expect(activeEntry).not.toBeNull();
    expect(activeEntry?.id).toBe(entry.id);
    expect(activeEntry?.name).toBe("テストWS");

    // ハンドラが構築する active オブジェクトの shape を検証
    const activePayload = activePath
      ? { id: activeEntry?.id ?? null, path: activePath, name: activeEntry?.name ?? null }
      : null;
    expect(activePayload?.id).toBe(entry.id);
    expect(activePayload?.path).toBe(activePath);
    expect(activePayload?.name).toBe("テストWS");
  });

  it("path 正規化ロバスト性: 冗長な './' を含む path でも findByPath が同一エントリを返す", async () => {
    const entry = await upsertWorkspace("/tmp/ws-normalize-test", "NormalizeWS");

    // wsBridge が setActivePath 経由で保持する path には path.resolve 済みの絶対パスが来るが
    // 万一 activePath に '/tmp/./ws-normalize-test' が来ても findByPath は normalizePath で解決できる
    const activePathWithDot = "/tmp/./ws-normalize-test";
    const activeEntry = await findByPath(activePathWithDot);

    expect(activeEntry).not.toBeNull();
    expect(activeEntry?.id).toBe(entry.id);
    expect(activeEntry?.name).toBe("NormalizeWS");
  });

  it("path 正規化ロバスト性: 冗長な '../' を含む path でも findByPath が同一エントリを返す", async () => {
    const entry = await upsertWorkspace("/tmp/ws-parent-test", "ParentWS");

    // 冗長な ../tmp/ws-parent-test は resolve すると /tmp/ws-parent-test と等価
    const activePathWithParent = "/tmp/other/../ws-parent-test";
    const activeEntry = await findByPath(activePathWithParent);

    expect(activeEntry).not.toBeNull();
    expect(activeEntry?.id).toBe(entry.id);
  });

  it("旧実装 (raw 文字列等価) の find 失敗パターンを再現: normalizePath 差で旧実装が壊れる", async () => {
    // upsertWorkspace は path.resolve で正規化して保存する
    const entry = await upsertWorkspace("/tmp/ws-raw-test", "RawWS");
    const { workspaces } = await listWorkspaces();

    // 旧実装: workspaces.find((w) => w.path === activePath) の raw 等価比較
    const rawActivePath = "/tmp/./ws-raw-test"; // resolve 前の冗長パス
    const oldStyleFind = workspaces.find((w) => w.path === rawActivePath);

    // 旧実装は null になる (id が取れない = 真因)
    expect(oldStyleFind).toBeUndefined();

    // 新実装: findByPath の normalizePath 経由
    const newStyleFind = await findByPath(rawActivePath);
    expect(newStyleFind?.id).toBe(entry.id); // 正しく解決できる
  });

  it("active が null の場合は active payload も null になる", async () => {
    // activePath = null のケース (workspace 未選択)
    const activePath: string | null = null;
    const activeEntry = activePath ? await findByPath(activePath) : null;
    const activePayload = activePath
      ? { id: activeEntry?.id ?? null, path: activePath, name: activeEntry?.name ?? null }
      : null;

    expect(activePayload).toBeNull();
  });

  it("findByPath で workspace が見つからない場合 active.id は null になる", async () => {
    // activePath が指す workspace が recentStore に未登録の場合
    const activePath = "/tmp/ws-not-registered";
    const activeEntry = await findByPath(activePath);

    expect(activeEntry).toBeNull();

    const activePayload = activePath
      ? { id: activeEntry?.id ?? null, path: activePath, name: activeEntry?.name ?? null }
      : null;
    expect(activePayload?.id).toBeNull();
  });
});
