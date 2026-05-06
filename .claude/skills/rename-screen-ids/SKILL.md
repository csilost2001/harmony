---
name: rename-screen-ids
description: 画面の未命名 ID (textInput1 等) を AI 推論で業務的な名前に一括リネームする
argument-hint: <screenId> (省略時は現在アクティブなデザイナータブ)
disable-model-invocation: true
---

<!--
  使い方:
    /rename-screen-ids                    # アクティブなデザイナータブの画面を対象
    /rename-screen-ids <screenId>         # 画面 ID を明示して指定

  処理フロー:
    1. get_rename_context で未命名項目を取得
    2. Claude が label / placeholder / htmlFragment / headingContext から業務名を推論
    3. マッピング表をユーザーに提示
    4. ユーザー確認後に apply_rename_mapping を実行
    5. 結果を報告

  前提:
    - backend が起動していること (ws://localhost:5179)
    - 対象画面の screen-items ファイルが存在すること (data/screen-items/<screenId>.json)
    - 未命名項目がない場合は何もしない

  自動発動禁止:
    disable-model-invocation: true により、ユーザーが明示的に /rename-screen-ids と
    打った時のみ起動する。「リネームして」等の自然言語では起動しない。
-->

# 画面項目 ID 自動命名

以下の手順を **この順序で** 実行してください。

## Step 1: 対象 screenId を決定する

引数 `$ARGUMENTS` が空でない場合はそれを screenId として使います。

空の場合は `designer__list_tabs` を呼び出し、アクティブな (●印) タブを探します。
- タブ ID が `design:<screenId>` 形式のタブが対象です
- `design:` プレフィックスを除いた部分が screenId です
- アクティブなデザイナータブがない場合は「画面デザイナーが開いていません。画面を開いてから再実行してください。」と伝えて終了します

## Step 2: 未命名項目を取得する

`designer__get_rename_context` を `screenId` で呼び出します。

- `unnamedItems` が空 (0 件) の場合: 「未命名項目はありません (全 {namedCount} 件は命名済みです)。」と伝えて終了します
- 未命名項目がある場合は次の Step へ進みます

## Step 3: 業務名を推論する

各 `unnamedItem` について、以下の情報を総合して業務的な名前を推論します:

**参照優先順位 (高→低):**
1. `label` — 画面項目の日本語ラベル (最も信頼性が高い)
2. `placeholder` — 入力欄のプレースホルダー
3. `headingContext` — 直前の見出し / legend テキスト
4. `htmlFragment` — 周辺 HTML 断片 (label タグ等を読み取る)

**命名規則:**
- **camelCase** で書く (例: `userName`, `postalCode`, `loginId`)
- 英数字のみ。ハイフン・アンダースコア・スペース不可
- JS 予約語禁止 (`let`, `const`, `class` 等)
- **30 字以内**
- 日本語の業務用語は英訳する (氏名→`fullName`, 郵便番号→`postalCode`)
- 単語の組み合わせは実装慣習に従う (メールアドレス→`email` or `emailAddress`)
- **推論不能な場合は mapping に含めない** (現在の自動採番 ID を維持する。無理に命名しない)
- `direction: "output"` の項目 (出力・表示系) も命名対象に含める。入力系と同じ命名規則を適用する (#359)

## Step 4: マッピングをユーザーに提示して確認を求める

以下の形式で表を提示します:

```
対象画面: <screenId>
未命名項目 <N> 件を以下の名前にリネームします:

| 現在の ID     | 推論した名前   | 根拠 (label / placeholder 等) |
|---------------|---------------|-------------------------------|
| textInput1    | fullName      | label: 氏名                   |
| textInput2    | postalCode    | label: 郵便番号                |
| select1       | prefCode      | label: 都道府県、placeholder: 選択 |
| (推論不能)    | — (スキップ) | 情報不足                       |

推論不能項目はスキップします (現在の ID を維持)。
このマッピングで適用してよいですか？ (yes でリネーム実行 / no でキャンセル / 修正があれば変更内容を伝えてください)
```

**ユーザーの返答を待ちます。** 返答なしに `apply_rename_mapping` を呼び出してはいけません。

### ユーザーが修正を求めた場合

修正後のマッピングを再提示し、再度確認を求めます。

### ユーザーが no / キャンセルした場合

「キャンセルしました。」と伝えて終了します。

## Step 5: リネームを適用する (yes の場合のみ)

推論不能でスキップした項目を除いた mapping を `designer__apply_rename_mapping` に渡します。

```json
{
  "screenId": "<screenId>",
  "mapping": {
    "textInput1": "fullName",
    "textInput2": "postalCode",
    "select1": "prefCode"
  }
}
```

## Step 6: 結果を報告する

以下の形式で報告します:

```
リネーム完了:
  成功: N 件
    ✓ textInput1 → fullName (処理フロー参照 2 箇所)
    ✓ textInput2 → postalCode
  失敗: M 件
    ✗ select1 → prefCode: ID "prefCode" は既に使用されています
  スキップ (推論不能): K 件
```

失敗がある場合は原因と対処法を一言添えます。
