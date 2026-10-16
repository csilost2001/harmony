import { describe, it, expect } from "vitest";
import { processFlowSequenceText, type SequenceDiagramInput } from "@harmony/shared";

const action: SequenceDiagramInput = {
  name: "注文確定", trigger: "POST /orders",
  steps: [
    { id: "s1", kind: "validation", description: "入力チェック" },
    { id: "s2", kind: "transactionScope", steps: [
      { id: "s3", kind: "dbAccess", tableId: "orders", operation: "insert", description: "注文を登録" },
      { id: "s4", kind: "branch", branches: [{ code: "A", label: "在庫あり", condition: { kind: "expression", expression: "stock > 0" }, steps: [{ id: "s5", kind: "externalSystem", systemRef: "payment", description: "決済" }] }], elseBranch: { code: "B", label: "在庫なし", steps: [{ id: "s6", kind: "return", description: "在庫切れ" }] } },
      { id: "s7", kind: "loop", description: "明細ごと", steps: [{ id: "s8", kind: "dbAccess", tableId: "order_items", operation: "insert" }] },
    ] },
    { id: "s9", kind: "screenTransition", targetScreenId: "done" },
    { id: "s10", kind: "log", description: "ログ" },
  ],
} as unknown as SequenceDiagramInput;
const ctx = { tableName: (id: string) => ({ orders: "注文", order_items: "注文明細" } as Record<string, string>)[id], screenName: (id: string) => (id === "done" ? "完了画面" : undefined) };

describe("processFlowSequenceText (続編 第 7 弾 #134)", () => {
  const m = processFlowSequenceText(action, "mermaid", ctx);
  it("Mermaid: 参加者・メッセージ・alt / loop・トランザクションの注記が並ぶ", () => {
    expect(m.startsWith("sequenceDiagram")).toBe(true);
    expect(m).toContain("actor P1 as 呼び出し元");
    expect(m).toContain("participant P3 as DB: 注文");
    expect(m).toContain("P1->>P2: 注文確定 (POST /orders)");
    expect(m).toContain("P2->>P3: 登録 (注文を登録)");
    expect(m).toContain("P3-->>P2: 結果");
    expect(m).toContain("Note over P2: トランザクション開始");
    expect(m).toContain("Note over P2: コミット");
    expect(m).toContain("alt 在庫あり [stock > 0]");
    expect(m).toContain("else 在庫なし");
    expect(m).toContain("loop 明細ごと");
    expect(m).toContain("-->>P1: 画面遷移: 完了画面");
    expect(m).not.toContain("ログ"); // やりとりでない工程は載せない
  });
  it("alt / loop の開きと閉じが合う", () => {
    const opens = (m.match(/^\s+(alt|loop) /gm) ?? []).length;
    const ends = (m.match(/^\s+end$/gm) ?? []).length;
    expect(opens).toBe(ends);
  });
  it("同じ DB・外部システムは参加者を 1 つにまとめる", () => {
    const again = processFlowSequenceText({ steps: [{ id: "a", kind: "dbAccess", tableId: "orders", operation: "select" }, { id: "b", kind: "dbAccess", tableId: "orders", operation: "update" }] } as unknown as SequenceDiagramInput, "mermaid", ctx);
    expect((again.match(/participant .* as DB: 注文/g) ?? []).length).toBe(1);
  });
  it("PlantUML でも作れる", () => {
    const u = processFlowSequenceText(action, "plantuml", ctx);
    expect(u.startsWith("@startuml")).toBe(true);
    expect(u.endsWith("@enduml")).toBe(true);
    expect(u).toContain('participant "DB: 注文" as P3');
    expect(u).toContain("P1 -> P2 :");
    expect(u).toContain("else 在庫なし");
  });
  it("工程が無くても、呼び出しだけの図になる", () => {
    expect(processFlowSequenceText({ steps: [] }, "mermaid")).toContain("P1->>P2: 実行");
  });
});
