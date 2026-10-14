import { describe, it, expect } from "vitest";
import { buildHistoryRows, describeEdit } from "./undoHistory";
import { diffJson } from "./jsonDiff";

const table = (cols: Array<Record<string, unknown>>) => ({ id: "t", name: "注文", columns: cols });

describe("describeEdit", () => {
  it("変更が無ければ、その旨を返す", () => {
    expect(describeEdit(diffJson(table([]), table([])))).toBe("(内容の変更なし)");
  });

  it("追加は、場所と「を追加」", () => {
    const text = describeEdit(diffJson(table([]), table([{ id: "c1", name: "注文ID" }])));
    expect(text).toContain("カラム");
    expect(text).toContain("を追加");
  });

  it("値の変更は、前後の値を添える。複数あれば「ほか n 件」", () => {
    const text = describeEdit(diffJson(table([{ id: "c1", name: "注文ID", dataType: "INT" }]), table([{ id: "c1", name: "注文ID", dataType: "BIGINT" }])));
    expect(text).toContain("データ型を変更");
    expect(text).toContain("INT → BIGINT");
    const many = describeEdit(diffJson(table([{ id: "c1", name: "a" }]), table([{ id: "c1", name: "b", dataType: "INT" }])));
    expect(many).toContain("ほか 1 件");
  });

  it("追加・削除は、変更より先に見出しになる", () => {
    const text = describeEdit(diffJson(
      table([{ id: "c1", name: "a" }]),
      table([{ id: "c1", name: "b" }, { id: "c2", name: "新" }]),
    ));
    expect(text).toContain("を追加");
    expect(text).toContain("ほか 1 件");
  });
});

describe("buildHistoryRows", () => {
  const s0 = table([]);
  const s1 = table([{ id: "c1", name: "a" }]);
  const s2 = table([{ id: "c1", name: "a" }, { id: "c2", name: "b" }]);
  const s3 = table([{ id: "c1", name: "a" }, { id: "c2", name: "b" }, { id: "c3", name: "c" }]);

  it("過去・いま・未来を時間順の操作にし、行ごとに「その操作の後の状態へ移る歩数」を持つ", () => {
    // 状態: s0 → s1 → [いま s2] → s3 (未来)
    const rows = buildHistoryRows([s0, s1], s2, [s3]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.delta)).toEqual([-1, 0, 1]);
    expect(rows.map((r) => r.current)).toEqual([false, true, false]);
    expect(rows.map((r) => r.future)).toEqual([false, false, true]);
    expect(rows.every((r) => r.label.includes("を追加"))).toBe(true);
  });

  it("履歴が無ければ空", () => {
    expect(buildHistoryRows([], s0, [])).toEqual([]);
  });

  it("すべて戻した状態 (過去なし・未来あり) では、いまの状態に当たる操作が無い", () => {
    const rows = buildHistoryRows([], s0, [s1, s2]);
    expect(rows.map((r) => r.delta)).toEqual([1, 2]);
    expect(rows.some((r) => r.current)).toBe(false);
  });
});
