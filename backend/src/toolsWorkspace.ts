// ワークスペース管理の MCP tool の定義 (#671)。tools.ts が大きくなったので分けた (順序は tools.ts の同じ位置に展開する)。
// 版の確認 (designer__check_harmony_update) もここ: この Harmony 自身の情報で、設計のデータとは別 (#1577)。
import { scaffoldTools } from "./toolsScaffold.js";

export const workspaceTools = [
  {
    name: "designer__workspace_list",
    description: "最近使ったワークスペース一覧と現在 active なワークスペース、lockdown 状態を返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_status",
    description: "現在 active なワークスペースの絶対パス・名前・lockdown フラグと、この Harmony の版 (harmony: version・commit・branch・dirty・builtAt・source) を返します。配布 image がどのブランチ・commit から作られたかが分かります。ネットワークは使いません。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__check_harmony_update",
    description:
      "この Harmony が、GitHub の最新の main より古くないかを確かめます (画面「連携と運用 → 版と更新」の「更新を確認する」と同じ。GitHub へ読み取りの問い合わせをします)。" +
      "status: current (最新) / behind (main より behindBy commit 古い) / unknown (確かめられない)。配布 image は、作ったときの commit (build-info.json) と main を比べます。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_open",
    description: "指定 path または id のワークスペースを active にし、recent に upsert します。init=true 指定時は path のフォルダを作成し harmony.json を初期化してから open します。lockdown モード時は error を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "ワークスペースの絶対パス。id と排他、どちらか必須。" },
        id: { type: "string", description: "recent 上の workspace id。path と排他。" },
        init: { type: "boolean", description: "true の場合、path のフォルダ作成と harmony.json 初期化を行ってから open します (path 必須)。" },
        dataDir: { type: "string", description: "init=true 時のデータディレクトリ名 (省略時: 'harmony')。harmony.json の dataDir フィールドに設定されます。" },
      },
      required: [],
    },
  },
  {
    name: "designer__workspace_inspect",
    description: "指定 path のフォルダ状態を判定して返します。status は 'ready' (harmony.json あり + schema 検証 pass), 'needsInit' (harmony.json なし), 'notFound' (フォルダ無し), 'invalid' (harmony.json が JSON 不正 or schema 違反) のいずれか。",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "判定対象の絶対パス" },
      },
      required: ["path"],
    },
  },
  {
    name: "designer__workspace_close",
    description: "現在 active なワークスペースを閉じます (active = null)。lockdown モード時は error を返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_remove",
    description: "recent からワークスペースエントリを除外します (fs は変更しません)。lockdown モード時は error を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "recent 上の workspace id" },
      },
      required: ["id"],
    },
  },
  // 開発コンテナの雛形の更新 (record_scaffold / get_scaffold_update。定義は toolsScaffold.ts)
  ...scaffoldTools,
];
