# shared/src/

frontend と backend が共有する、**画面なしで動く計算** (`@harmony/shared`)。変更したら shared を先に build する (`npm run build --workspace=@harmony/shared`)。**shared には試験の実行がない** — 試験は `frontend/src/` に置く。

| 場所 | 内容 |
|---|---|
| `designDocument.ts` | 設計書 (HTML) と要確認の組み立て |
| `flowStructure.ts` `flowWords.ts` `flowDecision.ts` | 処理フローの処理記述表・図の配置・テスト観点 / 条件の言葉への変換 / 判定表の計算 |
| `screenLayout.ts` `layoutComponents.ts` | 画面の部品の木・独自部品 |
| `businessFlow.ts` `report.ts` `markers.ts` | 業務フロー・帳票・マーカー |
| `analysis/` | 影響分析・未使用・用語・命名・進捗・SQL の一覧・テストデータ・OpenAPI |
| `importers/` | DDL / OpenAPI / Excel の取り込み |
| `export/` | Word / Excel の書き出し |
| `ops/` | 運用の記録の共通部分 (AI の書き込みの監査の対応表 `ops/auditTools.ts` など) |
| `index.ts` | 公開 (ここから export したものが `@harmony/shared`) |
