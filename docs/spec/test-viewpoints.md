# テスト観点表 — 仕様書

**Status**: 実装済 (2026-10)
**関連**: [design-document.md](design-document.md) / [screen-items.md](screen-items.md) / [process-flow-testing.md](process-flow-testing.md)

## 1. 目的

設計書 (原本) から、テスト仕様書の元になる**テスト観点表**を、決まった規則で自動導出する。正常・異常・境界値のケースを機械的に洗い出し、決まった ID を付けることで、テストコード (Playwright など) を AI または人が書くときの入力にする。

- 導出は**決定的** (同じ設計からは同じ表・同じ ID)。設計が変わらない限り ID は変わらない
- テストコードそのものは生成しない。セレクタや画面の実装 (技術スタック) に依存するため、観点表を入力に AI (`/generate-tests`) が書く

## 2. 画面入力の観点 (`shared/src/testViewpoints.ts`)

対象は、利用者が値を入れる画面項目。**表示専用 (`direction: out`)・読み取り専用・無効 (`disabled`)・画面に表示しない (`nonVisual`)・計算式 (`formula`)・配列やオブジェクトの項目は対象外**。

ID は `<画面 ID>.<項目 ID>.<規則>`。規則は次のとおり。

| 規則 | 区分 | 出る条件 | 内容 |
|---|---|---|---|
| `valid` | 正常系 | 常に | 制約を満たす代表値を入力する |
| `required-empty` | 異常系 | `required` | 空のまま (選択肢なら未選択) → 必須エラー |
| `optional-empty` | 正常系 | `required` でない | 空のまま → エラーにならない |
| `max-length-ok` / `max-length-over` | 境界値 | 文字列で `maxLength` | ちょうど / 1 文字超過 |
| `min-length-ok` / `min-length-under` | 境界値 | 文字列で `minLength` > 0 | ちょうど / 1 文字不足 |
| `pattern-invalid` | 異常系 | 文字列で `pattern` | 形式に合わない値 |
| `min-ok` / `min-under` | 境界値 | 数値で `min` | ちょうど / 1 刻み小さい (`under` は刻みが分かるとき: 整数または `step` あり) |
| `max-ok` / `max-over` | 境界値 | 数値で `max` | ちょうど / 1 刻み大きい (同上) |
| `not-a-number` | 異常系 | 数値 | 数字以外の文字 |
| `not-an-integer` | 異常系 | 整数 | 小数 |
| `option-valid` | 正常系 | `options` あり | 選択肢のどれかを選ぶ (`required-empty` も出る) |

- 規約カタログの参照 (`minRef` / `maxRef` / `minLengthRef` / `maxLengthRef` の `@conv.limit.<key>`、`pattern` の `@conv.regex.<key>`、`errorMessages` の `@conv.msg.<key>`) は値に解いて使う。解けない参照の制約はケースにしない
- `@conv.regex.<key>` に `exampleValid` / `exampleInvalid` があれば、`valid` と `pattern-invalid` の入力値に使う
- 期待するエラーメッセージは、項目の `errorMessages` (`required` / `maxLength` / `minLength` / `invalidFormat` / `outOfRange`) から取る

## 3. 処理の観点

処理フローの分岐と終了から導く ([flowStructure.ts](../../shared/src/flowStructure.ts) の `deriveTestViewpoints`)。ID は `<処理 ID>.<アクション ID>.TV-<連番>`。条件・期待結果 (HTTP ステータスなど)・終了ステップを持つ。

## 4. 出力

| 出力 | 内容 |
|---|---|
| 設計書の付録「テスト観点 (画面入力)」 | 画面ごとの表。要確認事項の後ろに置き、章番号は動かさない。入力のある画面があるときだけ出る。処理の観点は従来どおり各処理の節 |
| `npm run export:tests -- <workspace> [--format csv\|json\|md] [--out <file>] [--screen <id>] [--flow <id>]` | 画面入力と処理をまとめた表。既定は CSV (UTF-8 BOM つきで Excel で開ける)。json は機械処理・AI の入力用 (入力値つき) |

## 5. テストコードの書き方 (AI)

`/generate-tests` のとき、`npm run export:tests -- <workspace> --format json` の結果を入力にすると、観点と入力値・期待結果が決まっているため、画面の実装に合わせたセレクタを当てはめるだけで済む。テストの名前には観点表の ID を入れ、設計とテストを対応づける (`cart.addQuantity.max-over` など)。
