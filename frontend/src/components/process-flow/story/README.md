# 処理フローの「流れ」表示

AI が作った複雑な処理を人が読み、細かい仕様を人が書くための画面。仕様: `docs/spec/process-flow-story-view.md`。

| ファイル | 内容 |
|---|---|
| `ProcessFlowStory.tsx` | 全体 (入れ子・ガード・概要 / 詳細 / 実装・出口の一覧・変数の流れ) |
| `StoryRows.tsx` | 1 行 = 1 工程、道の枠、その場の編集 |
| `DecisionTable.tsx` | 判定表 (複合条件の分岐を表で見る・直す) |
| `StoryEditors.tsx` `StoryFieldEditors.tsx` | 条件の組み立て・種類ごとの項目の編集 |
| `storyModel.ts` `storyEdit.ts` `storyDecision.ts` | 表示のモデル / 編集の操作 (純粋関数) / 判定表の編集操作 |
| `conditionBuilder.ts` | 式 ⇄ 「どの値を・どうなら・何と比べる」の部品 |
| `sqlShape.ts` | SQL の結果が 1 件か一覧かの推定 |
| `storyShare.ts` `storyUi.ts` | 変わっていない部分を前の参照に戻す / 文脈 (`useRowUi` = 行が読む分・アクション全体を含まない、`useStoryUi` = 全部入り。行・枠・並びは `React.memo` なので、行の中では `useRowUi` を使う) |

条件の言葉への変換・判定表の計算は **`shared/src/flowWords.ts` と `shared/src/flowDecision.ts`** にある (設計書と共有)。
