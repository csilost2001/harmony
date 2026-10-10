/**
 * 設計全体の点検・派生の MCP tool handler。
 *
 * - designer__check_design         設計の要確認事項 (設計書ビューと同じ検査) を返す。AI が設計を直したあとの確認用
 * - designer__get_test_viewpoints  テスト観点表 (画面入力の境界値・処理の分岐、ID つき)。テストコードを書く入力にする
 *
 * 仕様: docs/spec/design-document.md / docs/spec/test-viewpoints.md
 */
import { buildDesignDocument, deriveTestViewpointSheet, testViewpointSheetToCsv } from "@harmony/shared";
import { loadDesignInputFromRoot } from "../designInput.js";
import type { ToolHandler } from "../mcpHelpers.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

export const handleDesignTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};
  switch (name) {
    case "designer__check_design": {
      const { input, skipped, counts } = await loadDesignInputFromRoot(root);
      const { issues } = buildDesignDocument(input);
      const all = [
        ...skipped.map((s) => ({ severity: "error" as const, section: "読み込み", message: `${s} を読めない (または見つからない) ため、検査に含まれていません` })),
        ...issues,
      ];
      const sum = { error: 0, warning: 0, info: 0 };
      for (const i of all) sum[i.severity]++;
      const includeInfo = a.includeInfo === true;
      return json({
        project: input.project.name,
        counts,
        summary: sum,
        ok: sum.error === 0 && sum.warning === 0,
        issues: all.filter((i) => includeInfo || i.severity !== "info"),
      });
    }

    case "designer__get_test_viewpoints": {
      const { input } = await loadDesignInputFromRoot(root);
      const onlyScreens = asIds(a.screenIds), onlyFlows = asIds(a.flowIds);
      const pick = <T,>(items: T[], ids: string[], idOf: (x: T) => string) => (ids.length ? items.filter((x) => ids.includes(idOf(x))) : items);
      const sheet = deriveTestViewpointSheet({
        limits: input.limits, regex: input.regex, messages: input.messages,
        screens: pick(input.screens.filter((s) => s.purpose !== "gadget"), onlyScreens, (s) => s.id),
        flows: pick(input.flows, onlyFlows, (f) => f.meta.id),
      });
      if (a.format === "csv") return { content: [{ type: "text" as const, text: testViewpointSheetToCsv(sheet) }] };
      return json(sheet);
    }

    default:
      return null;
  }
};
