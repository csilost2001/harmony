import { describe, expect, it, vi, beforeEach } from "vitest";
import { MAX_CHECKED, confirmDeletionImpact, describeDeletionImpact } from "./confirmDeletion";
import type { ReferenceResult } from "./references";

const request = vi.fn();
vi.mock("../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...a) } }));

const res = (id: string, referrers: ReferenceResult["referrers"]): { id: string; result: ReferenceResult } => ({
  id, result: { entityType: "screen", id, exists: true, referrers, total: referrers.length },
});

describe("削除の影響の文", () => {
  it("参照されていなければ null", () => {
    expect(describeDeletionImpact([res("cart", [])], "画面")).toBeNull();
  });

  it("参照元を列挙する (名前があれば名前)", () => {
    const m = describeDeletionImpact([res("cart", [{ kind: "businessFlow", id: "order", name: "注文", count: 2 }, { kind: "report", id: "slip", count: 1 }])], "画面")!;
    expect(m).toContain("画面「cart」← 業務フロー「注文」、帳票「slip」");
    expect(m).toContain("要確認");
  });

  it("同時に削除する設計どうしの参照は数えない", () => {
    const m = describeDeletionImpact([
      res("a", [{ kind: "screen", id: "b", count: 1 }]),
      res("b", [{ kind: "screen", id: "a", count: 1 }]),
    ], "画面");
    expect(m).toBeNull();
  });

  it("指定した種類の参照元は数えない (画面フローの中で画面を消すとき、画面フロー自身の遷移など)", () => {
    const r = res("cart", [{ kind: "screenFlow", id: "screen-flow", count: 3 }]);
    expect(describeDeletionImpact([r], "画面", ["screenFlow"])).toBeNull();
    expect(describeDeletionImpact([r], "画面")).not.toBeNull();
  });

  it("多いときは省略する", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: "processFlow" as const, id: `f${i}`, count: 1 }));
    expect(describeDeletionImpact([res("cart", many)], "画面")).toContain("ほか 4 件");
  });
});

describe("confirmDeletionImpact", () => {
  beforeEach(() => { request.mockReset(); vi.restoreAllMocks(); });
  const empty = (id: string) => ({ entityType: "screen", id, exists: true, referrers: [], total: 0 });

  it("参照されていなければ、確認なしで true", async () => {
    request.mockImplementation(async (_m: string, p: { id: string }) => empty(p.id));
    const confirm = vi.spyOn(window, "confirm");
    expect(await confirmDeletionImpact("screen", "画面", ["a", "b"])).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("参照されていれば確認し、答えを返す", async () => {
    request.mockResolvedValue({ ...empty("a"), referrers: [{ kind: "report", id: "slip", count: 1 }] });
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    expect(await confirmDeletionImpact("screen", "画面", ["a"])).toBe(false);
  });

  it("1 件ずつ調べ (同時に走らせない)、上限を超える分は調べない", async () => {
    let running = 0, maxRunning = 0;
    request.mockImplementation(async (_m: string, p: { id: string }) => {
      running++; maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return empty(p.id);
    });
    const ids = Array.from({ length: MAX_CHECKED + 5 }, (_, i) => `s${i}`);
    expect(await confirmDeletionImpact("screen", "画面", ids)).toBe(true);
    expect(request).toHaveBeenCalledTimes(MAX_CHECKED);
    expect(maxRunning).toBe(1);
  });

  it("調べられなかったときは、保存を止めない", async () => {
    request.mockRejectedValue(new Error("接続できません"));
    expect(await confirmDeletionImpact("screen", "画面", ["a"])).toBe(true);
  });
});
