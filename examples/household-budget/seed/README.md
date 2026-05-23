# seed/ — 初期サンプルデータ

家計簿アプリ examples を「開いた瞬間に動いている状態」にするための初期データ。本アプリは製品ではなくサンプルなので、空 DB から始めるより最初から多様なデータが入っているほうが、designer / 月次レポート / 一覧画面の挙動を確認しやすい。

## ファイル構成

| ファイル | テーブル | 件数 | 内容 |
|---|---|---|---|
| `users.json` | `users` | 1 | デモユーザー (login_id=`demo`) |
| `accounts.json` | `accounts` | 3 | 財布 / みずほ銀行 / 楽天カード |
| `categories.json` | `categories` | 12 | 支出 8 種 (食費 / 交通費 / 住居費 / 光熱費 / 通信費 / 娯楽 / 医療費 / その他支出) + 収入 4 種 (給与 / 副収入 / ボーナス / その他収入) |
| `transactions.json` | `transactions` | 40 | 2026-04-01 〜 2026-06-18 の 約 2.5 ヶ月分の取引 (給与 / 家賃 / 食費 / GW 旅行 / 通信費 / 医療 / 副収入 / ボーナス 等) |

## 形式

各ファイルは JSON 配列で、要素のキーは **DB 物理名 (snake_case)** を採用。`id` は seed が cross-reference (transactions が user_id / account_id / category_id を持つ) するため、explicit に固定値を割り当てる。

```jsonc
// accounts.json (抜粋)
[
  { "id": 1, "user_id": 1, "name": "財布", "account_type": "cash", "initial_balance": 30000, ... },
  { "id": 2, "user_id": 1, "name": "みずほ銀行", "account_type": "bank", "initial_balance": 500000, ... },
  ...
]
```

## インポート方法 (実装側 AI への指示)

NestJS + SQLite (`techStack.database.type`) で実装する場合、起動時の seed として:

1. 起動時に `seed/<table>.json` を読み込み
2. テーブル空の場合のみ `INSERT INTO ... VALUES ...` でインポート (idempotent)
3. PK 値を JSON 通りに維持 (SQLite の `INSERT OR IGNORE` 等で multi-run でも崩れないように)

Prisma / TypeORM 等の ORM 経由で seed する場合も、同じ JSON を入力にすれば良い。AI 実装者は `harmony/tables/*.json` の column 定義と本ディレクトリの seed を突き合わせて整合性を検証する。

## seed 内容の意図

| 種類 | 件数 / 範囲 | 意図 |
|---|---|---|
| 給与 (income) | 3 件 (4/5/6 月分) | 月次レポートで「収入」が必ず計上される |
| 家賃 (住居費) | 3 件 (毎月 5 日 or 8 日) | 固定費 (毎月 80000 円) を演出 |
| 食費 | 約 15 件 | 最頻出カテゴリ — 一覧 / ドーナツチャートの主役 |
| GW 旅行 | 5/5 食費 + 5/6 交通費 | 単発高額支出のスパイクを演出 |
| ボーナス | 5/15 50,000 円 | 月次レポートの「収入合計」を月によって変動させる |
| 副収入 | 4/20 と 6/15 | 給与以外の income カテゴリの存在感 |
| 楽天カードの利用 | 約 20 件 | クレジット利用が主流 (現金は少額のみ) — 口座種別の差を演出 |

## 注意

- 本データは **デモ用** であり、実在の人物・店舗・金額に基づくものではない
- `created_at` / `updated_at` は全て seed 投入時の固定値 `2026-06-20T00:00:00.000Z` 想定 (実装側は `CURRENT_TIMESTAMP` で上書き可)
