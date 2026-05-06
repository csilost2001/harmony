# バリデーション規約

**ステータス**: JSON 正本 (`data/conventions/catalog.json`)。本書は人間向け参考資料。
**策定日**: 2026-04-20 (#151-A) / 更新 2026-04-22 (#317 で JSON 正本化・編集 UI 搭載)
**関連 issue**: #151 (A: 設計書種別の追加) / #261 残 / #317 (UI 編集化)

本書は処理フロー仕様書が参照する横断的なバリデーション規約 (メッセージテンプレート + 正規表現カタログ + 境界値) を定める。

## 正本の場所 (#317 で改訂)

- **ランタイム正本**: `data/conventions/catalog.json` (gitignored)
- **サンプル (seed 元)**: [`docs/sample-project/conventions/conventions-catalog.json`](../sample-project/conventions/conventions-catalog.json) — `node docs/sample-project/seed.mjs` で `data/conventions/catalog.json` にコピーされる
- **JSON Schema**: [`schemas/conventions.schema.json`](../../schemas/conventions.schema.json)
- **参照整合性検証**: `frontend/src/schemas/conventionsValidator.ts` が処理フロー内の `@conv.*` 参照を検査
- **編集 UI**: 業務システムデザイナーの「規約カタログ」タブから閲覧・編集可 (#317)

**本 md 本文 (§1-§3) は人間向け参考資料**。編集・追加は基本的に designer アプリ経由で JSON を更新する。md と JSON で drift した場合は JSON 側が優先。

---

## 1. エラーメッセージ テンプレート

全画面・全フロー共通。敬体 (ですます) で統一、簡潔を旨とする。

| コード | 条件 | テンプレート | 置換例 |
|---|---|---|---|
| `msg.required` | 非空必須 | `{label}は必須入力です` | `氏名は必須入力です` |
| `msg.maxLength` | 最大文字数超過 | `{label}は{max}文字以内で入力してください` | `氏名は100文字以内で入力してください` |
| `msg.invalidFormat` | 形式不一致 | `{label}の形式が正しくありません` | `メールアドレスの形式が正しくありません` |
| `msg.duplicate` | 重複 | `この{label}は既に登録されています` | `このメールアドレスは既に登録されています` |
| `msg.outOfRange` | 範囲外 | `{label}は{min}〜{max}の範囲で入力してください` | `数量は1〜9999の範囲で入力してください` |
| `msg.mustBePositive` | 正数必須 | `{label}は1以上の数値を入力してください` | `数量は1以上の数値を入力してください` |

`{label}` は該当入力の表示名 (inputs[].label)、`{min}` / `{max}` は境界値。

---

## 2. 正規表現カタログ

| ID | 用途 | パターン | 例 OK | 例 NG |
|---|---|---|---|---|
| `regex.email-simple` | メールアドレス (RFC5322 簡易) | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | `a@b.jp` | `a@b` |
| `regex.phone-jp` | 国内電話番号 (固定/携帯、ハイフン必須) | `/^0\d{1,4}-\d{1,4}-\d{4}$/` | `080-1234-5678`, `03-1234-5678` | `+81-80-1234-5678`, `08012345678` |
| `regex.postal-jp` | 日本の郵便番号 (ハイフン任意、保存時は NNN-NNNN に正規化) | `/^\d{3}-?\d{4}$/` | `100-0001`, `1000001` | `10-00001` |
| `regex.kana-fullwidth` | 全角カタカナ (長音符・中黒・半角空白許容) | `/^[\u30A0-\u30FF ー・]+$/` | `ヤマダ タロウ`, `オオノ・ケンイチ` | `やまだ`, `YAMADA` |
| `regex.alnum` | 英数字のみ | `/^[A-Za-z0-9]+$/` | `Abc123` | `あいう`, `A-1` |

---

## 3. 境界値規約

| 項目 | 最大 | 最小 | 備考 |
|---|---|---|---|
| 氏名 (`name`) | 100 文字 | 1 | customers.name 等と整合 |
| 氏名カナ (`nameKana`) | 100 文字 | 1 | customers.name_kana 等 |
| メールアドレス | 255 文字 | 1 | RFC5321 準拠 |
| 電話番号 | 20 文字 | 1 | |
| 郵便番号 | 10 文字 | 1 | NNN-NNNN 正規化後は 8 文字 |
| 住所 | 500 文字 | 1 | |
| 会社名 | 200 文字 | 0 | 任意入力 |
| 備考 (notes) | 制限なし | 0 | TEXT 型 |
| 数量 | 9999 | 1 | INTEGER |
| 金額 | DECIMAL(12,0) の上限 | 0 | JPY 円 |

---

## 4. 処理フロー仕様書での参照方法 (Placeholder 運用)

処理フロー仕様内 (`ValidationStep.conditions` / `inputs[].description` / `step description` 等) では以下の ID で参照する:

- **正規表現**: `@conv.regex.email-simple` 等
- **メッセージ**: `@conv.msg.required` 等
- **境界値**: `@conv.limit.nameMax` 等 (§3 の表参照)

AI エージェントは本書を読み、ID を対応する正規表現 / テンプレート / 値に解決すること。

---

## 5. 変更履歴

- 2026-04-20: 初版プレースホルダー。issue #151-A で正式機能化予定。
