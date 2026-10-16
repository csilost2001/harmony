# 入力の信頼性・見通し — 仕様書 (UI 改善提案 第 5 弾)

**Status**: 実装済 (2026-10、ISSUE #1514)
**関連**: [ui-input-assist.md](ui-input-assist.md) / [ui-keyboard.md](ui-keyboard.md) / [ui-direct-manipulation.md](ui-direct-manipulation.md) / [edit-session-draft.md](edit-session-draft.md)

入力した結果が、合っているか・どこまで保存されているか・戻せるか、を、その場で見えるようにする。**原本は、保存するまで書き換えない** (明示保存モデル)。スキーマは変えない。キー操作の一覧は「?」(`utils/shortcuts.ts`)。

## 1. 入力欄の指摘と直し方 (#81・#82・#100)

| 対象 | 内容 | 実装 |
|---|---|---|
| ID・物理名の形式 | 画面項目の ID (camelCase)・カラムの物理名 (snake_case) が schema の形式に合わないとき、欄を赤くし (`aria-invalid`)、直下に理由と、直した値の案 (「`bad_name` に直す」= 1 クリック) を出す。物理名は直せる。**画面項目の ID は、改名が参照に影響するため、指摘だけ (直すボタンは出さない)** | `utils/identifierHints.ts` / `FieldHint.tsx` |
| 参照の打ち間違い (#100) | 参照 (`@conv.regex.postalcdoe` など) の最後の部分が、候補に無く、近い名前 (1〜2 文字違い・入れ替え) があるとき、「近い名前: postalCode」と、1 クリックで直すボタン。**入力が終わった欄 (フォーカスが外れた・開いた直後) だけ**で出す (入力中は、補完の候補と重なるため)。近い名前が無いものは、指摘しない (候補が網羅的でない参照への誤報を避ける) | `utils/referenceHints.ts` (analyzeReferences) / `useReferenceCompletion` |
| 式・条件の書き間違い (#82) | 式・条件の欄 (処理フローの実行条件など、`ConvCompletionInput` に処理フローを渡したもの) で、括弧・引用符の閉じ忘れ・演算子の前後に値が無い・`=` (代入) の誤り・AND / OR を検出して指摘する。**文法は決めない** (書き間違いの検出だけ。スキーマの範囲内) | `analyzeExpression` |
| 平文の言い直し (#82) | 単純な条件 (参照と値の比較を `&&` `||` でつないだもの) を「inputs.amount が 10000 以上、かつ inputs.status が locked と異なる のとき」と薄く出す。括弧・三項演算子を含む複雑な式は、言い直さない | `describeCondition` |

指摘のある欄 (`aria-invalid` / `.is-invalid` / `.has-error` / `.has-warning` / `data-issue`) は、F8 の対象になる (§3)。

## 2. 保存の状態・元に戻す (#83・#84・#85・#86・#87)

| 操作 | 内容 | 実装 |
|---|---|---|
| 保存の状態 (#83) | 編集中の保存ボタンのそばに「原本に未反映 / 下書きは 12:03 にサーバへ保存済み」「下書きをサーバへ送れていません」「原本と同じ (12:05 に保存)」。下書きの送信・保存の成功を、RPC の応答から記録する。**自動保存ではない** | `store/saveStatus.ts` / `EditModeToolbar.tsx` / `mcpBridge.ts` |
| 変更した欄 (#84) | **カラムの「表で編集」**: 保存した (読み込んだ) 内容と違う欄に色が付き、「↺」でその欄だけ保存済みの値に戻せる。新しい行に「新規」。保存すると消える。基準は `useResourceEditor` の `baseline` | `utils/fieldDiff.ts` / `ColumnGrid.tsx` |
| 元に戻す・やり直し (#85) | 汎用定義の編集にも、元に戻す・やり直し・変更履歴 (Ctrl+Z / Ctrl+Y)。入力中の連続した変更は、止まって 0.7 秒たつと 1 回分。業務フロー・帳票は、既にあった | `GenericDefinitionEditor.tsx` / `useUndoableState` |
| 何を戻したか (#86) | 元に戻す・やり直しのたびに「元に戻しました: カラム『金額』の追加」のように、短く知らせる。配列の追加・削除と、値の変更から作る | `utils/changeSummary.ts` |
| 取り消せる削除 (#87) | 取り消し (Ctrl+Z) が効く削除は、確認を出さず即実行し、「削除しました (Ctrl+Z で戻せます)」。対象: アウトラインでの工程の削除・処理フローのアクションの削除・ER 図の論理リレーションの削除・画面フローのグループの削除。**ファイルを消す削除 (一覧からの帳票・業務フロー・汎用定義の削除) と、画面フローの画面の削除は、確認を残す** | 各エディタ |

**`useUndoableState` を、純粋な更新関数に作り直した** (履歴を、1 つの状態の中に持つ)。React の StrictMode は更新関数を 2 回呼ぶため、外の変数を書き換える作りだと、commit と undo が続くと、戻せなかった (試験: `useUndoableState.test.tsx`)。

## 3. 移動・見通し (#88・#90・#92・#95)

| 操作 | 内容 | 実装 |
|---|---|---|
| 次の要確認 (#88) | **F8 / Shift+F8** で、いまの画面の次 / 前の要確認へ移る (巡る)。左下に「要確認 N 件 (k 件目)」。ダイアログが開いているあいだは動かない | `shell/PageIssueNav.tsx` / `utils/pageIssues.ts` |
| 保存失敗後 (#92) | 保存の失敗を通知したあと、最初の要確認の欄へ移る (原因の欄を探さなくてよい)。接続できない失敗では移らない | `utils/failureToast.ts` |
| 処理フローの目次 (#90) | 左の欄の「ブロック / 目次」。工程を入れ子の番号 (1・2.1・2.2) で並べ、分岐の条件・else・繰り返しの見出しつき。クリック / Enter でその工程へ移り、画面に見えている工程・選んでいる工程を強調。文字で絞り込める | `utils/stepOutline.ts` / `StepOutlinePanel.tsx` |
| 直接のリンク (#95) | URL の末尾 `#step=s3` / `#item=qty` / `#column=<id>` / `#node=<id>` / `#marker=<id>` で開くと、その要素へ移って強調 (8 秒まで、出るのを待つ)。**Ctrl+Alt+L** で、フォーカスのある工程・項目・カラム・部品・マーカーへのリンクをコピー | `utils/deepLink.ts` / `shell/DeepLinkControl.tsx` (`data-deeplink`) |
| 入力専用モード (#98) | **Ctrl+Alt+F** (コマンドパレットからも) で、ヘッダーとタブを畳む。右上のボタンで戻す。このブラウザのタブの中だけ (sessionStorage) | `store/focusMode.ts` / `FocusModeControl.tsx` |

## 4. 日本語入力・読み込み (#93・#94・#96)

| 操作 | 内容 | 実装 |
|---|---|---|
| 入力モード (#93) | ID・物理名の欄 (`asciiFieldProps`) に、自動の大文字化・自動修正・スペルチェックを止める属性と `lang="en"` を付ける。(ブラウザが IME を自動で半角にする標準の属性は無い。変換されて入った全角は、次の正規化で直す) | `utils/fieldNormalize.ts` |
| 全角・空白の正規化 (#94) | 印 (`data-norm="ascii"`) のある欄で、貼り付けると全角英数・記号・スペースを半角にし、前後の空白・改行を除く (Ctrl+Z で貼り付ける前に戻せる)。フォーカスが外れたときにも、残っていれば直す。直したときだけ知らせる。**名称の欄は変換しない** | `hooks/useFieldNormalizer.ts` |
| 読み込み中 (#96) | 編集画面 10 か所の読み込み中を共通の表示にし、6 秒たっても終わらなければ「時間がかかっています」と「再試行」を出す | `LoadingBlock.tsx` |

## 5. 入力の手数の予算 (#97)

主要な 4 作業 (テーブルにカラムを足す・処理フローに工程を挿入・画面に項目を足す・参照を入力する) の操作数 (クリック + キー入力) を E2E で数え、`frontend/e2e/operation-budget.json` の上限を超えたら落とす。UI を直して減ったら上限も下げる。試験: `e2e/operation-budget.spec.ts` (回帰に含む)。`npm run check` ではなく、回帰 E2E の中で止める。

## 6. 見送り・一部だけのもの (提案文からの差)

- **#81**: 欄の直下の指摘は、ID・物理名・参照・式の欄。全部の入力欄への一般化はしていない (欄ごとに、何が違反かを決める必要があるため)
- **#84**: 変更した欄の強調は、カラムの表で編集だけ (画面項目の表・ほかの編集画面は未対応)
- **#85**: 業務フロー・帳票は、元に戻す・変更履歴が**既にあった** (提案文の「見当たらない」は誤り)。汎用定義だけ足した
- **#89**: スキーマの `description` は、ほとんどの項目が空で、`examples` は無いため、スキーマからは作っていない。代わりに、既存の「?」(項目ごとのヘルプ) を、カラムの表・条件実行へ足した。「例を入れる」ボタンは未対応
- **#91**: 編集の排他は、「編集セッション」(下書きごと) の仕組みに変わっていて、ロックの表示・閲覧・引き継ぎは**既にある** (`EditSessionDropdown`)。足したのは、他の人が編集中のバッジに、誰が・最終操作がいつかの説明
- **#99**: 処理フローには、選んだ工程を文脈にした「AI に頼む」(`AiRequestPanel`) と、提案の差分での採用・却下 (`AiDiffPreviewDialog`) が**既にある**。画面項目・カラムは、マーカー (AI への依頼。第 4 弾) で頼む (コマンドパレットの名前を「AI に頼む」に)。ほかの設計への一般化 (Codex への依頼・差分の確認の部品の共通化) は、別の大きな機能
- **#82**: 条件の文法を決めていないため、検出は書き間違いに限る。参照の存在・型の検査と、複雑な式の平文化は未対応

## 7. 試験

- 単体: `changeSummary` / `fieldNormalize` / `identifierHints` / `referenceHints` / `pageIssues` / `deepLink` / `stepOutline` / `fieldDiff` / `saveStatus` / `useUndoableState` (StrictMode) / `LoadingBlock`
- E2E: `generic-definition-edit` (元に戻す・通知) / `field-normalize` / `save-status` / `undoable-delete` / `focus-mode` / `page-issues` / `expression-hints` / `deep-link` / `step-outline` / `changed-fields` / `operation-budget`
