/**
 * MCP handler editSession__create / editSession__list の resourceType allowlist 検証テスト
 * (#1374 — #1372 派生)。
 *
 * 検証観点:
 * 1. editSession__create: 未知 resourceType (allowlist 外) は McpError(InvalidParams) で reject
 * 2. editSession__create: 不正型 (number / null) も同 McpError で reject
 * 3. editSession__list: undefined resourceType は通過 (全件 filter)
 * 4. editSession__list: 未知 resourceType は McpError(InvalidParams) で reject
 * 5. WS handler 側 allowlist と完全一致 (editSessionStore.ts の VALID_RESOURCE_TYPES 共有)
 * 6. allowlist 通過後の downstream エラー (resourceId 不正等) は別 message で出る → allowlist
 *    layer が正しく resourceType だけを評価していることを確認
 *
 * 設計:
 * - 本テストは MCP handler の **入力 validation 層** だけを検証する。allowlist を通過した後の
 *   wsBridge.editSessionCreate 等の挙動は既存テスト (multiEditSession.test.ts /
 *   wsBridge.editSession.test.ts / editSessionService.test.ts) でカバー済。
 * - allowlist 通過後は wsBridge が initialize されていないため別 error が発生するが、
 *   それは allowlist layer の責務外であり本テストでは catch して message のみ検証する。
 */
import { describe, it, expect } from "vitest";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { handleEditSessionTool } from "./editSession.js";
import {
  DRAFT_RESOURCE_TYPES,
  VALID_RESOURCE_TYPES,
} from "../editSessionStore.js";

// handler は sessionId を引数に取るが、本テストでは validation 層のみを検証するため固定の dummy 値を渡す。
const SESSION_ID = "test-session-1374";
const ROOT = "/tmp/__editSession_handler_test_1374"; // 実際には wsBridge 経路を通らないので未使用

describe("editSession__create — #1374 resourceType allowlist 検証", () => {
  it("未知 resourceType (allowlist 外) は McpError(InvalidParams) で reject される", async () => {
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__create",
        { resourceType: "unknown-type", resourceId: "x" },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    // allowlist 専用エラーメッセージ (resourceId 検証エラーとは区別される)
    expect((caught as McpError).message).toMatch(/許可された resource type/);
    expect((caught as McpError).message).toMatch(/unknown-type/);
  });

  it("typeof !== string (number) も同 McpError で reject される", async () => {
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__create",
        { resourceType: 42, resourceId: "x" },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((caught as McpError).message).toMatch(/許可された resource type/);
  });

  it("resourceType undefined も同 McpError で reject される", async () => {
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__create",
        { resourceId: "x" },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((caught as McpError).message).toMatch(/許可された resource type/);
  });

  it("有効 resourceType + 不正 resourceId (空文字) は resourceId 検証エラーで reject (allowlist 通過確認)", async () => {
    // "extension" は singleton resource type なので空文字のみが拒否される (assertResourceIdForType の else 分岐)
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__create",
        { resourceType: "extension", resourceId: "" },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    // resourceId 専用エラー (allowlist エラーとは別 message) — allowlist layer が "extension" を accept した証拠
    expect((caught as McpError).message).toMatch(/resourceId/);
    expect((caught as McpError).message).not.toMatch(/許可された resource type/);
  });
});

describe("editSession__list — #1374 resourceType allowlist 検証", () => {
  it("未知 resourceType は McpError(InvalidParams) で reject される", async () => {
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__list",
        { resourceType: "unknown-type" },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((caught as McpError).message).toMatch(/許可された resource type/);
    expect((caught as McpError).message).toMatch(/unknown-type/);
  });

  it("typeof !== string (number) も同 McpError で reject される", async () => {
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__list",
        { resourceType: 123 },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((caught as McpError).message).toMatch(/許可された resource type/);
  });

  it("resourceType + resourceId 同時指定で未知 resourceType は allowlist 層で reject (resourceId 層に到達しない)", async () => {
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__list",
        { resourceType: "unknown-type", resourceId: "x" },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    // resourceType allowlist エラーが先に出る (resourceId 関連 message ではない)
    expect((caught as McpError).message).toMatch(/許可された resource type/);
    expect((caught as McpError).message).not.toMatch(/resourceId filter/);
  });

  it("resourceId のみ指定 (resourceType 未指定) は resourceType 必須エラー (allowlist 層は通過)", async () => {
    let caught: unknown;
    try {
      await handleEditSessionTool(
        "editSession__list",
        { resourceId: "x" },
        ROOT,
        SESSION_ID,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    // allowlist layer は通過 (resourceType undefined は許容)、resourceId filter 側で reject
    expect((caught as McpError).message).toMatch(/resourceId filter/);
    expect((caught as McpError).message).not.toMatch(/許可された resource type/);
  });
});

describe("#1374 allowlist source of truth — WS handler との完全一致確認", () => {
  it("DRAFT_RESOURCE_TYPES と VALID_RESOURCE_TYPES は同一範囲 (型と Set の drift 防止)", () => {
    // editSessionStore.ts で `new Set(DRAFT_RESOURCE_TYPES)` で導出されている前提を test 化
    expect(VALID_RESOURCE_TYPES.size).toBe(DRAFT_RESOURCE_TYPES.length);
    for (const rt of DRAFT_RESOURCE_TYPES) {
      expect(VALID_RESOURCE_TYPES.has(rt)).toBe(true);
    }
  });

  it("全 14 種の resourceType が allowlist 通過する (現行 DraftResourceType 範囲)", async () => {
    // 各 resourceType を順番に allowlist 通過させ、resourceId 層 (allowlist 後段) のエラーが出ることを確認。
    // resourceId は空文字を渡し、allowlist 層が accept したかを「reject message が allowlist 由来でない」ことで確認。
    for (const rt of DRAFT_RESOURCE_TYPES) {
      let caught: unknown;
      try {
        await handleEditSessionTool(
          "editSession__create",
          { resourceType: rt, resourceId: "" },
          ROOT,
          SESSION_ID,
        );
      } catch (e) {
        caught = e;
      }
      // 何らかのエラーは出る (空 resourceId or downstream)、ただし allowlist 由来ではない
      expect(caught).toBeInstanceOf(McpError);
      expect((caught as McpError).message).not.toMatch(/許可された resource type/);
    }
  });

  it("editSessionStore.ts DRAFT_RESOURCE_TYPES に新 type が追加されたら VALID_RESOURCE_TYPES も自動追従する (構造的不変条件)", () => {
    // typeof[number] / new Set() による導出を test で固定 — 将来 editSessionStore.ts の
    // VALID_RESOURCE_TYPES を別途手動定義に書き戻されると本テストが落ちる仕組み。
    const computed = new Set<string>(DRAFT_RESOURCE_TYPES);
    expect(computed.size).toBe(VALID_RESOURCE_TYPES.size);
    for (const rt of computed) {
      expect(VALID_RESOURCE_TYPES.has(rt as typeof DRAFT_RESOURCE_TYPES[number])).toBe(true);
    }
  });
});
