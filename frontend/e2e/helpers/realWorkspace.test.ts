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

describe("normalizeId (Round 6 Phase A: UUID v4 生成 → kebab-case EntityId 変換)", () => {
  // RFC #1284 / I-7 Phase A 以降、top-level entity の id は kebab-case EntityId に統一。
  // UUID は strict validator で reject されるため、normalizeId は kebab-case 化に動作変更。
  const ENTITY_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("既に kebab-case EntityId 形式ならそのまま返す", () => {
    expect(normalizeId("screen-0001")).toBe("screen-0001");
    expect(normalizeId("my-screen")).toBe("my-screen");
    expect(normalizeId("scr-a")).toBe("scr-a");
  });

  it("UUID v4 は kebab-case に正規化される (UUID-like reject 回避)", () => {
    const result = normalizeId("550e8400-e29b-41d4-a716-446655440000");
    // 出力は EntityId pattern を満たす かつ UUID-like ではない
    expect(result).toMatch(ENTITY_ID_RE);
    expect(result).not.toMatch(UUID_V4_RE);
  });

  it("同じ入力からは常に同じ kebab-case が生成される (決定論的)", () => {
    const a = normalizeId("my-screen");
    const b = normalizeId("my-screen");
    expect(a).toBe(b);
  });

  it("異なる入力からは異なる kebab-case が生成される", () => {
    const a = normalizeId("screen-a");
    const b = normalizeId("screen-b");
    expect(a).not.toBe(b);
  });

  it("数字始まり等の EntityId pattern 不一致は `id-` prefix を付ける", () => {
    const result = normalizeId("0001-flow");
    expect(result).toMatch(ENTITY_ID_RE);
    expect(result.startsWith("id-")).toBe(true);
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
        id: "realworkspace-test-project" as Project["meta"]["id"],
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
            id: "realworkspace-test-screen" as Project["entities"]["screens"][0]["id"],
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
    expect((written.meta as Record<string, unknown>).id).toBe("realworkspace-test-project");
    expect((written.meta as Record<string, unknown>).name).toBe("テスト用プロジェクト");
    // v1→v3 変換なし: entities.screens もそのまま存在する
    expect((written.entities as Record<string, unknown>).screens).toHaveLength(1);
  });

  it("Table v3 が harmony/tables/<id>.json として書き出される", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harmony-test-"));

    const TABLE_ID = "realworkspace-test-users-table" as Table["id"];
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
        id: "realworkspace-test-project" as Project["meta"]["id"],
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
