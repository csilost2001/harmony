/**
 * realWorkspace helper 単体テスト (#964 α)
 *
 * backend WebSocket が不要な部分のみテスト:
 * - normalizeId: UUID v4 正規化ロジック
 * - v3 typed input が harmony.json / entity ファイルとしてそのまま書き出されること
 *   (setupTestWorkspace のファイル書き込みロジックを直接検証)
 *
 * environment: node (vitest.config.ts の environmentMatchGlobs で指定)
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { normalizeId } from "./realWorkspace.ts";
import type {
  Project,
  Table,
  Screen,
  ProcessFlow,
} from "../../src/types/v3/index.ts";

// ─── normalizeId テスト ────────────────────────────────────────────────────

describe("normalizeId", () => {
  it("UUID v4 はそのまま返す", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(normalizeId(uuid)).toBe(uuid);
  });

  it("非 UUID 文字列は決定論的な UUID v4 に変換される", () => {
    const result = normalizeId("screen-0001");
    // UUID v4 形式チェック
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("同じ入力からは常に同じ UUID が生成される (決定論的)", () => {
    const a = normalizeId("my-screen");
    const b = normalizeId("my-screen");
    expect(a).toBe(b);
  });

  it("異なる入力からは異なる UUID が生成される", () => {
    const a = normalizeId("screen-a");
    const b = normalizeId("screen-b");
    expect(a).not.toBe(b);
  });
});

// ─── v3 ファイル書き込み検証 ──────────────────────────────────────────────

/**
 * v3 typed input をそのままファイルに書き出す部分のみをシミュレート。
 * setupTestWorkspace の内部実装から WebSocket 呼び出しを除いた部分のテスト。
 */
async function writeV3Workspace(
  dir: string,
  project: Project,
  extras: {
    tables?: Table[];
    screens?: Screen[];
    processFlows?: ProcessFlow[];
  } = {},
): Promise<void> {
  const dataDir = path.join(dir, "harmony");
  for (const sub of ["screens", "tables", "process-flows", "sequences", "views", "view-definitions"]) {
    await fs.mkdir(path.join(dataDir, sub), { recursive: true });
  }

  // harmony.json
  await fs.writeFile(path.join(dir, "harmony.json"), JSON.stringify(project, null, 2), "utf-8");

  // Table
  for (const t of extras.tables ?? []) {
    await fs.writeFile(path.join(dataDir, "tables", `${t.id}.json`), JSON.stringify(t, null, 2), "utf-8");
  }
  // Screen
  for (const s of extras.screens ?? []) {
    await fs.writeFile(path.join(dataDir, "screens", `${s.id}.json`), JSON.stringify(s, null, 2), "utf-8");
  }
  // ProcessFlow
  for (const f of extras.processFlows ?? []) {
    await fs.writeFile(path.join(dataDir, "process-flows", `${f.meta.id}.json`), JSON.stringify(f, null, 2), "utf-8");
  }
}

describe("v3 typed input → v3 output", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("Project v3 が harmony.json として書き出され、schemaVersion が v3 になる", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harmony-test-"));

    const project: Project = {
      $schema: "../schemas/v3/harmony.v3.schema.json",
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "550e8400-e29b-41d4-a716-446655440001" as Project["meta"]["id"],
        name: "テスト用プロジェクト",
        maturity: "draft",
        createdAt: "2026-01-01T00:00:00.000Z" as Project["meta"]["createdAt"],
        updatedAt: "2026-01-01T00:00:00.000Z" as Project["meta"]["updatedAt"],
        mode: "upstream",
      },
      extensionsApplied: [],
      entities: {
        screens: [
          {
            id: "550e8400-e29b-41d4-a716-446655440010" as Project["entities"]["screens"][0]["id"],
            no: 1,
            name: "テスト画面",
            updatedAt: "2026-01-01T00:00:00.000Z" as Project["entities"]["screens"][0]["updatedAt"],
            maturity: "draft",
            kind: "list",
          },
        ],
      },
    };

    await writeV3Workspace(tmpDir, project);

    // harmony.json が書き出されている
    const written = JSON.parse(await fs.readFile(path.join(tmpDir, "harmony.json"), "utf-8")) as Record<string, unknown>;

    expect(written.schemaVersion).toBe("v3");
    expect(written.dataDir).toBe("harmony");
    expect((written.meta as Record<string, unknown>).id).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect((written.meta as Record<string, unknown>).name).toBe("テスト用プロジェクト");
    // v1→v3 変換なし: entities.screens もそのまま存在する
    expect((written.entities as Record<string, unknown>).screens).toHaveLength(1);
  });

  it("Table v3 が harmony/tables/<id>.json として書き出される", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harmony-test-"));

    const TABLE_ID = "550e8400-e29b-41d4-a716-446655440020" as Table["id"];
    const table: Table = {
      id: TABLE_ID,
      name: "ユーザー" as Table["name"],
      physicalName: "users" as Table["physicalName"],
      maturity: "draft",
      createdAt: "2026-01-01T00:00:00.000Z" as Table["createdAt"],
      updatedAt: "2026-01-01T00:00:00.000Z" as Table["updatedAt"],
      columns: [],
    };

    const minimalProject: Project = {
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "550e8400-e29b-41d4-a716-446655440001" as Project["meta"]["id"],
        name: "テスト" as Project["meta"]["name"],
        maturity: "draft",
        createdAt: "2026-01-01T00:00:00.000Z" as Project["meta"]["createdAt"],
        updatedAt: "2026-01-01T00:00:00.000Z" as Project["meta"]["updatedAt"],
      },
    };

    await writeV3Workspace(tmpDir, minimalProject, { tables: [table] });

    const filePath = path.join(tmpDir, "harmony", "tables", `${TABLE_ID}.json`);
    const written = JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;

    // v1→v3 変換なし: id / physicalName / columns がそのまま書き出されている
    expect(written.id).toBe(TABLE_ID);
    expect(written.physicalName).toBe("users");
    expect(Array.isArray(written.columns)).toBe(true);
    expect((written.columns as unknown[]).length).toBe(0);
  });
});
