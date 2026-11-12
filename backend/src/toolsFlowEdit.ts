// 処理フローのアクション・本体 (meta) の部分更新と、重複した工程の id の振り直しの MCP tool の定義 (#1603)。
// tools.ts が行数の予算に達しているので分けた (tools.ts の `...flowEditTools,` で展開する)。処理は handlers/flowEdit.ts
const flowAndApply = {
  processFlowId: { type: "string", description: "処理フローの id" },
  apply: { type: "boolean", description: "true で保存 (既定は予行)" },
};

export const flowEditTools = [
  {
    name: "designer__update_action",
    description: "処理フローのアクション 1 つに patch を合わせる (一番上の項目ごとに置き換え。値を null にした項目は消す)。名前・説明・trigger・inputs・outputs・httpRoute・responses などを、処理フロー全体を送り直さずに直す。id と steps は変えられない (工程は edit_steps / update_step など)。既定は予行 (apply: true で保存)。画面で開いている処理フローは断る。この編集で増えたスキーマ違反を返す。",
    inputSchema: {
      type: "object" as const,
      properties: { ...flowAndApply, actionId: { type: "string" }, patch: { type: "object", description: "合わせる項目 (例: { \"description\": \"…\", \"inputs\": [...] })" } },
      required: ["processFlowId", "actionId", "patch"],
    },
  },
  {
    name: "designer__remove_action",
    description: "処理フローのアクション 1 つを、中の工程ごと消す。既定は予行 (apply: true で保存)。画面で開いている処理フローは断る。消す前に designer__find_references で、画面のイベントなどからの参照を確かめる。",
    inputSchema: {
      type: "object" as const,
      properties: { ...flowAndApply, actionId: { type: "string" } },
      required: ["processFlowId", "actionId"],
    },
  },
  {
    name: "designer__update_flow_meta",
    description: "処理フロー本体 (meta) に patch を合わせる (一番上の項目ごとに置き換え。値を null にした項目は消す)。名前・説明・flowType・screenId・maturity などを直す。id は変えられない (改名は designer__rename_entity)。既定は予行 (apply: true で保存)。画面で開いている処理フローは断る。",
    inputSchema: {
      type: "object" as const,
      properties: { ...flowAndApply, patch: { type: "object", description: "合わせる項目 (例: { \"description\": \"…\" })" } },
      required: ["processFlowId", "patch"],
    },
  },
  {
    name: "designer__renumber_step_ids",
    description: "処理フローの中で重複した工程の id を振り直す。最初に出てきた工程は元の id のまま、2 つ目以降に新しい id を付ける。別のアクションで重複していた工程は、そのアクションの中の参照 (compensatesFor・分岐の条件の stepId) も付け替える。工程の id が重複していると、工程を id で指す tool は actionId なしでは断るので、そのときに使う。既定は予行 (apply: true で保存)。画面で開いている処理フローは断る。",
    inputSchema: {
      type: "object" as const,
      properties: { ...flowAndApply },
      required: ["processFlowId"],
    },
  },
];
