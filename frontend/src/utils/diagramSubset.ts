/** 図で選んだノードだけの、設計の入力 (Mermaid / PlantUML の書き出し用。ER: テーブル / 画面フロー: 画面と、その間の遷移) */
import type { DesignDocInput } from "@harmony/shared";

export function subsetInput(input: DesignDocInput, kind: "er" | "screenFlow", ids: ReadonlySet<string>): DesignDocInput {
  if (kind === "er") return { ...input, tables: input.tables.filter((t) => ids.has(t.id)) };
  return {
    ...input,
    screens: input.screens.filter((s) => ids.has(s.id)),
    transitions: input.transitions?.filter((t) => ids.has(t.sourceScreenId) && ids.has(t.targetScreenId)),
  };
}
