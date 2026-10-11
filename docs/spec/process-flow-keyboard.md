# 処理フロー: キーボード操作

マウスを使わず、キーボードだけで工程を辿る・開閉する・挿入する・入れ子にする (Tab のインデント) 操作。編集の仕組み (編集中・保存・元に戻す) は従来のままで、操作の入口だけを増やす。原本 (JSON) とスキーマは変えない。

## 基本の考え方

- 各工程の**見出し** (`.step-card-header`) がキーボードの足場。Tab で見出しにカーソルを置ける (`tabIndex=0`、`aria-expanded` で開閉を伝える)。
- 矢印キー (↑↓ / Home / End) で見出しへ移ると、その工程が「選択」にもなる (Tab で入ったときは選択しない)。既存の選択ショートカット (複製・削除・上下へ動かす 等) がそのまま使える。
- 入力欄の中では、文字入力を妨げない (矢印・Tab は通常どおり)。Esc で見出しへ戻る。

## 操作

| キー | 動作 |
|---|---|
| ↑ / ↓ | 表示されている前後の工程へ。Home / End で最初・最後 |
| → / ← | 工程を開く / 閉じる。Space で切り替え |
| Enter / F2 | 工程を開き、最初の入力欄 (textarea / input) へ |
| Insert または `/` | 工程の挿入メニューを開く。種類を入力して絞り込み、↑↓ + Enter で選ぶ。選ぶと見出しの次に挿入され、新しい工程の入力欄へカーソルが入る |
| Tab | **(注意: 親の実行条件・失敗の扱いが子にも及ぶ。兄弟だった工程の実行条件が変わる)** 直前の工程の配下 (`subSteps` の末尾) へ入れる。入れ子の中でも、直前の兄弟の配下へ。最初の工程ではできないので、通常の Tab (フォーカス移動) のまま。移した先が閉じていれば開き、動かした工程の見出しにカーソルが残る |
| Shift+Tab | 親の次の位置へ出す。後ろにいた兄弟は、出した工程の配下に引き継ぐ (実行順を変えないため)。親がいなければ通常の Tab |
| Esc | 入力欄 → 見出しへ戻る |
| Ctrl+Enter (入力欄の中) | 次の工程を挿入 |
| Insert (工程以外の場所) | 末尾へ工程を挿入 |

編集中でないとき (閲覧) は、移動・開閉だけが使える。

入れ子の形と実行の意味は [process-flow-substeps.md](process-flow-substeps.md)。動かす処理は `frontend/src/utils/stepTree.ts` (`indentStep` / `outdentStep`)。

## 実装

- `frontend/src/components/process-flow/internal/useStepKeyboard.ts` — DOM のイベントを見て、挿入・インデント・アウトデントを `ProcessFlowEditor` へ依頼するフック。
- `frontend/src/components/process-flow/internal/StepInsertMenu.tsx` — 種類を絞り込む挿入メニュー (combobox)。
- 子の工程は親の `.step-card` の中ではなく、同じ `.step-card-wrapper` 内の `.sub-steps` に描画される。入れ子の判定はこの構造に依存する。
- ショートカット一覧 (`?` キー) は `frontend/src/utils/shortcuts.ts`。

## 関連・残課題

- 表のキーボード編集: [grid-keyboard.md](grid-keyboard.md) (実装済み)
- テキスト主体の編集 (アウトライン): [process-flow-outline.md](process-flow-outline.md) (試作。字下げで入れ子を書ける)
