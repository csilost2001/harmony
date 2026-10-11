# 処理フロー: 工程の入れ子 (subSteps)

工程 (Step) は、`subSteps` で配下の工程を持てる。UI の「インデント」(Tab)・「サブステップ追加」・アウトラインの字下げが書き込む先。

承認: 設計者 (2026-10-11、#1487 案 A「工程の共通項目に `subSteps` を足す」)。下の「実行の意味」は、案 A の趣旨 (親の実行条件・順序を子が継ぐ) に沿って AI が定めたもので、設計者の個別確認は未了 (レビュー・マージ時に確認する)。スキーマは `process-flow.v3.schema.json` の `StepBaseProps.subSteps`。

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
- 工程のメニューの「サブステップ追加」は、**繰り返し・トランザクションでは従来どおり本体 (`steps`) の末尾**へ、それ以外の種類では `subSteps` へ追加する (入れ子の中の工程でも同じ振り分け)。
- マウスの「インデント」「アウトデント」(工程カードのボタン) も、キーボードと同じ意味 (アウトデントは、後ろの兄弟を外した工程の配下へ引き継ぎ、実行順を変えない。空になった `subSteps` は書かない)。
- インデントすると、親の実行条件 (`runIf`)・失敗の扱いが子にも及ぶ (親が実行されなければ子も実行されない)。兄弟だった工程の実行条件が変わることに注意する。
- アウトラインでは、字下げ (空白 2 つ) が入れ子 ([process-flow-outline.md](process-flow-outline.md))。
