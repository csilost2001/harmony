# プロダクトスコープ規約 (人間向け参考資料)

> **正本は active workspace の `<dataDir>/conventions/catalog.json`** (例: `workspaces/<wsId>/<dataDir>/conventions/catalog.json`、scope / currency / tax / auth / db / numbering / tx / externalOutcomeDefaults カテゴリ)。
> 本 md はその人間向け参考資料であり、AI・ツールは JSON を参照すること (#346)。
> サンプル: `examples/<project-id>/harmony/conventions/catalog.json` (例: `examples/retail/harmony/conventions/catalog.json`)。
> `docs/conventions/validation-rules.md` と同じ扱い。

**策定日**: 2026-04-20
**関連 issue**: #151 (A: 設計書種別の追加), #346

本書は処理フロー仕様書が暗黙の前提とするプロダクトの**業務スコープ**を定める。個別の仕様書で「国内のみか? 多言語対応要否?」等を毎回書かなくて済むよう、ここで一括宣言する。

---

## 1. 顧客スコープ

- **国内顧客のみ** (個人 + 法人、在住/在所は日本国内を前提)
- 海外顧客はスコープ外 (将来の拡張候補)

**含意**:
- 住所は日本の住所体系 (都道府県〜市区町村〜番地、郵便番号 NNN-NNNN)
- 電話番号は国内フォーマット (`regex.phone-jp`) で良い。国際番号形式 (`+81-...`) は非対応
- タイムゾーンは JST (Asia/Tokyo) 固定

## 2. 言語

- **日本語のみ** (UI / メール文面 / 帳票 / エラーメッセージ)
- 多言語化 (i18n) はスコープ外

**含意**:
- 全角/半角の文字種別は日本語前提で扱う
- テンプレート言語: 基本は日本語のみ、名称の英語併記は個別に画面設計で

## 3. 通貨・金額

- **日本円 (JPY) のみ**
- 税計算: **外税 10%** (消費税率 2026 年時点)
- 端数処理: **切り捨て** (1 円未満は切り捨て)
- 型: `DECIMAL(12, 0)` で保存 (銭の単位なし)

**含意**:
- 外貨対応はスコープ外
- 税率変更時は本書を更新

## 4. 決済手段

- **クレジットカード / 銀行振込 / 代金引換** の 3 種
- 外部決済ゲートウェイ: **Stripe Japan** を想定 (実装時差し替え可)

## 5. 個人情報・本人確認

- 本人確認 (KYC) は**不要** (現行業務では住所 + 電話 + メールで同定)
- 個人情報保護法の範囲内で運用
- 論理削除 (`is_deleted = true`) は物理削除せず保持する (監査要件)

## 6. 認証・セッション

- **画面ごとに認証要否を個別に指定**する (公開経路 = 認証不要、管理経路 = 認証必須)
- セッション管理: httpOnly Cookie + server session
- パスワード: bcrypt (cost 12) でハッシュ化

## 7. API 規約

- **REST** / JSON (Content-Type: `application/json`)
- **認証不要画面**: 顧客登録画面 (`/customers/new` からの POST) 等、公開サービスで使うもの
- **認証必須画面**: 注文登録・管理系・バッチトリガ 等
- エラーレスポンス形式: `{ code: string, message: string, fieldErrors?: Record<string,string> }`
- HTTP ステータスマッピング: `VALIDATION=400 / UNAUTHENTICATED=401 / FORBIDDEN=403 / NOT_FOUND=404 / DUPLICATE=409 / INTERNAL=500`

## 8. DB 規約

- PostgreSQL 14+
- 物理名: `snake_case`
- 論理削除: `is_deleted BOOLEAN NOT NULL DEFAULT false`
- タイムスタンプ: `created_at` / `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- ID: `INTEGER auto-increment` が基本、ビジネスコードは別途 `{ENTITY}_code VARCHAR UNIQUE` として DB DEFAULT で採番

## 9. 採番規約 (placeholder)

| エンティティ | 採番形式 | 実装 |
|---|---|---|
| 顧客コード (`customer_code`) | `C-NNNN` (4 桁ゼロパディング) | PG シーケンス + DEFAULT |
| 注文番号 (`order_number`) | `ORD-YYYY-NNNN` (年 + 4 桁ゼロパディング) | PG シーケンス + トリガ |

## 10. トランザクション・競合制御 (placeholder)

- **単一操作は 1 TX**。複数操作が原子的である必要があれば明示的に TX 境界を指定
- **外部 API 呼出は TX 外** を原則とする (DB ロック時間短縮、冪等性の外部管理)
- 並行登録の重複防止: **部分 UNIQUE INDEX** (例: `UNIQUE (email) WHERE is_deleted = false`) + 23505 エラーハンドリング
- 在庫引当 等の並行減算: **条件付き UPDATE** (`SET stock = stock - ? WHERE ... AND stock >= ?`) + 影響行数チェック

## 11. 外部連携の outcome 規約

外部 API 呼出 (メール送信・決済・住所補完 等) の結果処理は以下のパターンで統一:

| outcome | 同期レスポンス | ログ | リトライ |
|---|---|---|---|
| `success` | 続行 | info ログ | なし |
| `failure` (4xx/5xx 明示エラー) | 呼出がクリティカルなら中断、fire-and-forget なら続行 | error (Sentry) | **なし (v1)**、必要時は運用対応 |
| `timeout` | `failure` と同じ扱い、既定タイムアウト 10 秒 | error (Sentry) | **なし (v1)** |

## 12. 変更履歴

- 2026-04-20: 初版プレースホルダー。issue #151-A で正式機能化予定。
