# 処理フロー: 工程の入れ子 (subSteps)

工程 (Step) は、`subSteps` で配下の工程を持てる。UI の「インデント」(Tab)・「サブステップ追加」・アウトラインの字下げが書き込む先。

承認: 設計者 (2026-10-11、#1487 案 A)。スキーマは `process-flow.v3.schema.json` の `StepBaseProps.subSteps`。

## 形

```jsonc
{ "id": "step-02", "kind": "dbAccess", "description": "カートを取得する",
  "subSteps": [
    { "id": "step-03", "kind": "compute", "description": "取得した件数を数える" }
  ] }
```

- すべての種類の工程が持てる (`StepBaseProps` の共通項目)。要素は `Step`、深さに制限はない。
- 空配列は書かない (子が無ければ省略)。
- 子の `id` は、他の工程・分岐と同じくフロー全体で一意 (`LocalId`)。

## 実行の意味

1. 親の本体の処理が終わったあと、`subSteps` を配列の順に実行する (分岐の `steps` や繰り返しの本体 `steps` とは別。それぞれの種類が持つ本体は従来どおり)。
2. 親の `runIf` が false なら、親も子も実行しない。子の `runIf` は評価もされない ([process-flow-expression-language.md](process-flow-expression-language.md))。
3. 親が失敗 (throw) したら、子は実行しない。
4. 子の `outputBinding` の変数は、親の次の工程と同じ流れの中で参照できる (入れ子で変数の範囲は閉じない)。

## 検査・書き出し

- 工程を辿る処理 (参照整合・規約・画面遷移・SQL カラム・ID 採番・設計書・図) は `subSteps` の中も辿る。
- 設計書・図では、子を親の下にインデントして示す。

## 操作

- 工程の見出しで Tab = 直前の工程の `subSteps` の末尾へ、Shift+Tab = 親の次の位置へ ([process-flow-keyboard.md](process-flow-keyboard.md))。
- 工程のメニューの「サブステップ追加」は `subSteps` へ追加する。
- アウトラインでは、字下げ (空白 2 つ) が入れ子 ([process-flow-outline.md](process-flow-outline.md))。
