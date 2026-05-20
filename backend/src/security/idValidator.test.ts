/**
 * idValidator.ts のユニットテスト (S-002, #1225)
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  isValidUuid,
  isValidSafeName,
  isValidKind,
  assertUuid,
  assertSafeName,
  assertKind,
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
