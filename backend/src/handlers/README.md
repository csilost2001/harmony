# backend/src/handlers/

MCP の tool の実装。**tool の定義は `../tools.ts`、振り分けは `../mcpServer.ts`**。各 handler は `ToolHandler` (`../mcpHelpers.ts`) の形で、自分の tool でなければ `null` を返す。

| ファイル | tool |
|---|---|
| `processFlow.ts` | 処理フロー・アクション・工程(1 つずつ)・カタログ・成熟度 |
| `flowBatch.ts` | `edit_steps` (工程のまとめての編集。保存済みのファイルだけが対象) |
| `screen.ts` `screenItem.ts` `layout.ts` `pageLayout.ts` `edge.ts` | 画面・画面項目・業務部品・ページレイアウト・画面フロー |
| `table.ts` `ddl.ts` | テーブル・DDL・ER |
| `businessFlow.ts` `report.ts` | 業務フロー・帳票 |
| `design.ts` | 点検・分析・改名・参照の付け替え・版・生成の記録・レビュー・設計全体の要約 |
| `designKinds.ts` | シーケンス・ビュー・汎用定義・規約・技術スタック・DDL / OpenAPI の取り込み |
| `designInsight.ts` | 検索・工程単位の取得・「流れ」の文章・分岐の分析・検証だけ・変更の差分・比較・設計書の章・tool の詳細 |
| `marker.ts` | マーカー |
| `tab.ts` `workspace.ts` `editSession.ts` `export.ts` | タブ・ワークスペース・編集セッション・書き出し |

新しい tool を足すとき: `../tools.ts` に定義 → handler → (読むだけなら) `../security/mcpAccess.ts` の `READ_ONLY_TOOLS`・`../security/mcpProfiles.ts`・(書くなら) `shared/src/ops/auditTools.ts` の対応表。試験が、どれかが抜けると落ちる。仕様: `docs/spec/mcp-design-access.md`。
