/**
 * idValidator.ts のユニットテスト (S-002, #1225)
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  isValidUuid,
  isValidSafeName,
  isValidKind,
  isValidHistoryId,
  isValidEntityId,
  assertUuid,
  assertSafeName,
  assertKind,
  assertHistoryId,
  assertEntityId,
  assertPathContained,
} from "./idValidator.js";

// ── isValidUuid ───────────────────────────────────────────────────────────────

describe("isValidUuid", () => {
  it("正常: 有効な UUID v4 を受け入れる", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUuid("267e94bf-0397-44b8-b665-d3c40c38935b")).toBe(true);
    expect(isValidUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("異常: 空文字", () => {
    expect(isValidUuid("")).toBe(false);
  });

  it("異常: path traversal (..) を含む", () => {
    expect(isValidUuid("../etc/passwd")).toBe(false);
    expect(isValidUuid("..")).toBe(false);
  });

  it("異常: URL-encoded path traversal (%2e%2e%2f) → false (SH-004)", () => {
    // URL デコード後に path traversal になる文字列も UUID regex で弾かれる
    expect(isValidUuid("%2e%2e%2fetc%2fpasswd")).toBe(false);
    expect(isValidUuid("%2e%2e%2f")).toBe(false);
  });

  it("異常: 絶対パス", () => {
    expect(isValidUuid("/etc/passwd")).toBe(false);
  });

  it("異常: null byte を含む", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000\0")).toBe(false);
  });

  it("異常: UUID より長い文字列", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000-extra")).toBe(false);
  });

  it("異常: null", () => {
    expect(isValidUuid(null)).toBe(false);
  });

  it("異常: undefined", () => {
    expect(isValidUuid(undefined)).toBe(false);
  });

  it("異常: 数値", () => {
    expect(isValidUuid(123)).toBe(false);
  });
});

// ── isValidSafeName ───────────────────────────────────────────────────────────

describe("isValidSafeName", () => {
  it("正常: 英字のみ", () => {
    expect(isValidSafeName("myName")).toBe(true);
  });

  it("正常: 英数字 + ハイフン + アンダースコア", () => {
    expect(isValidSafeName("my-name_123")).toBe(true);
  });

  it("正常: 1 文字", () => {
    expect(isValidSafeName("a")).toBe(true);
  });

  it("正常: 64 文字ちょうど", () => {
    expect(isValidSafeName("a".repeat(64))).toBe(true);
  });

  it("異常: 空文字", () => {
    expect(isValidSafeName("")).toBe(false);
  });

  it("異常: 65 文字超え", () => {
    expect(isValidSafeName("a".repeat(65))).toBe(false);
  });

  it("異常: .. (path traversal)", () => {
    expect(isValidSafeName("..")).toBe(false);
  });

  it("異常: URL-encoded path traversal (%2e%2e%2f, ..%2F) → false (SH-004)", () => {
    // URL デコード後に path traversal になる文字列も SafeName regex で弾かれる
    expect(isValidSafeName("..%2F")).toBe(false);
    expect(isValidSafeName("..%2f")).toBe(false);
    expect(isValidSafeName("%2e%2e%2f")).toBe(false);
  });

  it("異常: URL-encoded null byte (%00) → false (SH-004)", () => {
    expect(isValidSafeName("%00")).toBe(false);
  });

  it("異常: スラッシュを含む", () => {
    expect(isValidSafeName("a/b")).toBe(false);
  });

  it("異常: null byte", () => {
    expect(isValidSafeName("a\0b")).toBe(false);
  });

  it("異常: 日本語文字", () => {
    expect(isValidSafeName("名前")).toBe(false);
  });
});

// ── isValidKind ───────────────────────────────────────────────────────────────

describe("isValidKind", () => {
  it("正常: lowercase alphanumeric + hyphen", () => {
    expect(isValidKind("domain-type")).toBe(true);
    expect(isValidKind("application-rule")).toBe(true);
    expect(isValidKind("component-definition")).toBe(true);
  });

  it("正常: namespace:kind 形式 (コロン含む)", () => {
    expect(isValidKind("english-learning:conversationPlayer")).toBe(false); // uppercase C → invalid
    expect(isValidKind("english-learning:conversation-player")).toBe(true);
  });

  it("正常: 短い kind", () => {
    expect(isValidKind("a")).toBe(true);
    expect(isValidKind("ab")).toBe(true);
  });

  it("異常: 空文字", () => {
    expect(isValidKind("")).toBe(false);
  });

  it("異常: 大文字で始まる", () => {
    expect(isValidKind("Domain-type")).toBe(false);
  });

  it("異常: .. (path traversal)", () => {
    expect(isValidKind("../evil")).toBe(false);
  });

  it("異常: スラッシュを含む", () => {
    expect(isValidKind("a/b")).toBe(false);
  });
});

// ── assertUuid ────────────────────────────────────────────────────────────────

describe("assertUuid", () => {
  it("正常: 有効 UUID なら値を返す", () => {
    const id = "267e94bf-0397-44b8-b665-d3c40c38935b";
    expect(assertUuid(id, "screenId")).toBe(id);
  });

  it("異常: 無効 ID なら Error を throw", () => {
    expect(() => assertUuid("../evil", "screenId")).toThrow("Invalid screenId");
    expect(() => assertUuid("", "screenId")).toThrow("Invalid screenId");
    expect(() => assertUuid(null, "screenId")).toThrow("Invalid screenId");
  });
});

// ── assertSafeName ────────────────────────────────────────────────────────────

describe("assertSafeName", () => {
  it("正常: 有効な name なら値を返す", () => {
    expect(assertSafeName("OrderForm", "name")).toBe("OrderForm");
    expect(assertSafeName("my-name_123", "name")).toBe("my-name_123");
  });

  it("異常: 無効 name なら Error を throw", () => {
    expect(() => assertSafeName("..", "name")).toThrow("Invalid name");
    expect(() => assertSafeName("../evil", "name")).toThrow("Invalid name");
    expect(() => assertSafeName("a".repeat(65), "name")).toThrow("Invalid name");
  });
});

// ── assertKind ────────────────────────────────────────────────────────────────

describe("assertKind", () => {
  it("正常: 有効な kind なら値を返す", () => {
    expect(assertKind("domain-type", "kind")).toBe("domain-type");
  });

  it("異常: 無効 kind なら Error を throw", () => {
    expect(() => assertKind("../evil", "kind")).toThrow("Invalid kind");
    expect(() => assertKind("", "kind")).toThrow("Invalid kind");
    expect(() => assertKind("Domain", "kind")).toThrow("Invalid kind");
  });
});

// ── isValidHistoryId / assertHistoryId ───────────────────────────────────────

describe("isValidHistoryId", () => {
  it("正常: 実形式 '<ISO-safe-timestamp>--<idPrefix>-<rand>'", () => {
    expect(isValidHistoryId("2026-05-19T10-30-00.000Z--abc123def456-xy12")).toBe(true);
    expect(isValidHistoryId("2026-05-19T10-30-00.000Z--ABCDEF123456-ab34")).toBe(true);
  });

  it("正常: 最短 1 文字", () => {
    expect(isValidHistoryId("a")).toBe(true);
  });

  it("正常: 128 文字ちょうど", () => {
    expect(isValidHistoryId("a".repeat(128))).toBe(true);
  });

  it("異常: 空文字", () => {
    expect(isValidHistoryId("")).toBe(false);
  });

  it("異常: 129 文字超え", () => {
    expect(isValidHistoryId("a".repeat(129))).toBe(false);
  });

  it("異常: スラッシュを含む (path traversal)", () => {
    expect(isValidHistoryId("../etc/shadow")).toBe(false);
    expect(isValidHistoryId("../../etc/passwd")).toBe(false);
    expect(isValidHistoryId("a/b")).toBe(false);
  });

  it("異常: バックスラッシュを含む (Windows path traversal)", () => {
    expect(isValidHistoryId("..\\evil")).toBe(false);
    expect(isValidHistoryId("a\\b")).toBe(false);
  });

  it("異常: \"..\" のみ", () => {
    expect(isValidHistoryId("..")).toBe(false);
  });

  it("異常: URL-encoded path separator (%2F, %5C) → regex が弾く", () => {
    expect(isValidHistoryId("..%2Fetc%2Fshadow")).toBe(false);
    expect(isValidHistoryId("..%5Cevil")).toBe(false);
  });

  it("異常: null byte", () => {
    expect(isValidHistoryId("abc\0def")).toBe(false);
  });

  it("異常: null", () => {
    expect(isValidHistoryId(null)).toBe(false);
  });

  it("異常: undefined", () => {
    expect(isValidHistoryId(undefined)).toBe(false);
  });

  it("異常: 数値", () => {
    expect(isValidHistoryId(42)).toBe(false);
  });
});

describe("assertHistoryId", () => {
  it("正常: 有効な historyId なら値を返す", () => {
    const id = "2026-05-19T10-30-00.000Z--abc123-xy12";
    expect(assertHistoryId(id, "historyId")).toBe(id);
  });

  it("異常: path traversal を含む場合 Error を throw", () => {
    expect(() => assertHistoryId("../etc/shadow", "historyId")).toThrow("Invalid historyId");
    expect(() => assertHistoryId("../../etc/passwd", "historyId")).toThrow("Invalid historyId");
    expect(() => assertHistoryId("..%2Fetc", "historyId")).toThrow("Invalid historyId");
  });

  it("異常: バックスラッシュ path traversal で Error を throw", () => {
    expect(() => assertHistoryId("..\\evil", "historyId")).toThrow("Invalid historyId");
  });

  it("異常: 空文字で Error を throw", () => {
    expect(() => assertHistoryId("", "historyId")).toThrow("Invalid historyId");
  });

  it("異常: null で Error を throw", () => {
    expect(() => assertHistoryId(null, "historyId")).toThrow("Invalid historyId");
  });
});

// ── isValidEntityId / assertEntityId (RFC #1284) ──────────────────────────────

describe("isValidEntityId", () => {
  it("正常: 単一の小文字英字 (1 文字)", () => {
    expect(isValidEntityId("a")).toBe(true);
  });

  it("正常: kebab-case 英単語", () => {
    expect(isValidEntityId("order-form")).toBe(true);
    expect(isValidEntityId("customer-master")).toBe(true);
    expect(isValidEntityId("flow-1")).toBe(true);
    expect(isValidEntityId("step-01")).toBe(true);
  });

  it("正常: 単一の小文字英字 + 数字", () => {
    expect(isValidEntityId("a1")).toBe(true);
    expect(isValidEntityId("order123")).toBe(true);
  });

  it("正常: 64 文字ちょうど", () => {
    expect(isValidEntityId("a".repeat(64))).toBe(true);
  });

  it("異常: 65 文字超え", () => {
    expect(isValidEntityId("a".repeat(65))).toBe(false);
  });

  it("異常: 空文字", () => {
    expect(isValidEntityId("")).toBe(false);
  });

  it("異常: 大文字を含む", () => {
    expect(isValidEntityId("OrderForm")).toBe(false);
    expect(isValidEntityId("order-Form")).toBe(false);
  });

  it("異常: 数字で始まる", () => {
    expect(isValidEntityId("1-order")).toBe(false);
    expect(isValidEntityId("0abc")).toBe(false);
  });

  it("異常: ハイフンで始まる", () => {
    expect(isValidEntityId("-order")).toBe(false);
  });

  it("異常: ハイフンで終わる", () => {
    expect(isValidEntityId("order-")).toBe(false);
  });

  it("異常: 連続ハイフン", () => {
    expect(isValidEntityId("order--form")).toBe(false);
  });

  it("異常: アンダースコアを含む", () => {
    expect(isValidEntityId("order_form")).toBe(false);
  });

  it("異常: 日本語を含む", () => {
    expect(isValidEntityId("注文画面")).toBe(false);
    expect(isValidEntityId("order-注文")).toBe(false);
  });

  it("異常: UUID 形式 (EntityId 単独では UUID を受け入れない)", () => {
    expect(isValidEntityId("267e94bf-0397-44b8-b665-d3c40c38935b")).toBe(false);
  });

  // I-7 Round 2 (#1299 Codex review M-1) regression: alpha-leading UUID (先頭が a-f) は
  // 旧 ENTITY_ID_RE に偶然合致するため、UUID_RE で明示的に除外する必要がある。
  // compat shim (Phase A 撤廃) の意図を保ち、assertEntityId 経由で旧 UUID id が
  // RPC 経路を通過しないことを保証する。
  it("異常: alpha-leading UUID (Codex review M-1 regression)", () => {
    // 先頭文字が a-f の RFC 4122 UUID v4 サンプル
    expect(isValidEntityId("a0000000-0000-4000-8000-000000000000")).toBe(false);
    expect(isValidEntityId("f81dd9e0-794c-4539-a2a5-9cbcc0a75899")).toBe(false);
    expect(isValidEntityId("b1234567-89ab-4cde-9f01-23456789abcd")).toBe(false);
    expect(isValidEntityId("c0ffeebe-1234-4567-89ab-cdef01234567")).toBe(false);
    expect(isValidEntityId("deadbeef-1234-4abc-8def-1234567890ab")).toBe(false);
    expect(isValidEntityId("e1f2a3b4-c5d6-4e7f-89a0-b1c2d3e4f506")).toBe(false);
    // v4 以外 (version digit が 4 でない) loose UUID も EntityId としては reject
    expect(isValidEntityId("a0000000-0000-1000-8000-000000000000")).toBe(false);
  });

  it("正常: UUID と prefix が似た kebab-case は受け入れる (false-positive 回避)", () => {
    // UUID と segment 数が異なる kebab-case は引き続き valid
    expect(isValidEntityId("abc-def")).toBe(true);
    expect(isValidEntityId("a0-b1-c2")).toBe(true);
    // 8-4-4-4-12 構造でも segment 数が違えば valid
    expect(isValidEntityId("abc12345")).toBe(true);
  });

  it("異常: path traversal (..)", () => {
    expect(isValidEntityId("..")).toBe(false);
    expect(isValidEntityId("../evil")).toBe(false);
  });

  it("異常: null / undefined / 数値", () => {
    expect(isValidEntityId(null)).toBe(false);
    expect(isValidEntityId(undefined)).toBe(false);
    expect(isValidEntityId(123)).toBe(false);
  });
});

describe("assertEntityId", () => {
  it("正常: 有効な EntityId なら値を返す", () => {
    expect(assertEntityId("order-form", "screenId")).toBe("order-form");
  });

  it("異常: 大文字を含むと throw", () => {
    expect(() => assertEntityId("OrderForm", "screenId")).toThrow("Invalid screenId");
  });

  it("異常: UUID 形式は assertEntityId では reject (strict)", () => {
    expect(() => assertEntityId("267e94bf-0397-44b8-b665-d3c40c38935b", "screenId")).toThrow("Invalid screenId");
  });

  it("異常: alpha-leading UUID も assertEntityId では reject (#1299 Codex M-1 regression)", () => {
    expect(() => assertEntityId("f81dd9e0-794c-4539-a2a5-9cbcc0a75899", "screenId")).toThrow("Invalid screenId");
    expect(() => assertEntityId("a0000000-0000-4000-8000-000000000000", "tableId")).toThrow("Invalid tableId");
  });

  it("異常: 空文字で throw", () => {
    expect(() => assertEntityId("", "screenId")).toThrow("Invalid screenId");
  });

  it("異常: null で throw", () => {
    expect(() => assertEntityId(null, "screenId")).toThrow("Invalid screenId");
  });
});

// ── assertPathContained ───────────────────────────────────────────────────────

describe("assertPathContained", () => {
  const root = "/tmp/test-workspace";

  it("正常: target が root 配下にある", () => {
    const target = path.join(root, "screens", "abc.json");
    expect(assertPathContained(target, root)).toBe(path.resolve(target));
  });

  it("正常: target が root 自体", () => {
    expect(assertPathContained(root, root)).toBe(path.resolve(root));
  });

  it("異常: target が root の外に出る (../ 攻撃)", () => {
    const evil = path.join(root, "..", "..", "etc", "passwd");
    expect(() => assertPathContained(evil, root)).toThrow("Path traversal detected");
  });

  it("異常: target が root と sibling ディレクトリ", () => {
    const sibling = "/tmp/other-workspace/evil.json";
    expect(() => assertPathContained(sibling, root)).toThrow("Path traversal detected");
  });

  it("異常: target が prefix 一致だが sep なしで繋がる (root + 'evil' 形式)", () => {
    // /tmp/test-workspace-evil のような path は /tmp/test-workspace に含まれない
    const evil = root + "-evil/file.json";
    expect(() => assertPathContained(evil, root)).toThrow("Path traversal detected");
  });

  it("正常: ネストした deep パス", () => {
    const deep = path.join(root, "a", "b", "c", "d.json");
    expect(assertPathContained(deep, root)).toBe(path.resolve(deep));
  });
});
