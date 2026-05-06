# 画面項目定義 (Screen Items)

**ステータス**: v3 整合 (schema v3.0.2 確定済)
**策定開始**: 2026-04-22
**凍結日 v1.0**: 2026-04-23
**更新 v1.1**: 2026-04-24 — 出力項目の `displayFormat` / `valueFrom` 追加 (#377)
**改訂日: 2026-04-28 (v3 反映)**: schema を `schemas/v3/screen-item.v3.schema.json` に整合、`FieldType` を v3 確定形 (custom 廃止 / integer / datetime / json / domain / file / extension 追加)、`ValueSource.flowVariable.variableName` を `IdentifierPath` (#533 R3-1)、`tableColumn` / `viewColumn` を `TableColumnRef` / `ViewColumnRef` (Pattern B 複合参照、物理名直書き廃止)
**改訂日: 2026-05-03 (Phase 4-β reversal 反映)**: A-1 独立ファイル方式 (`screen-items/<screenId>.json`) を **廃止**、`screens/<screenId>.json` の `items[]` への **embed のみ** に統一 (#712)。runtime (`backend`) は `screen-items/` を読まず、新規 workspace 作成時にも生成しない。validator (`runtimeContractValidator [LEGACY_SCREEN_ITEMS_DIR]`, #714) が legacy 配置を検出する
**関連 issue**: #318 #354 #377 #533 (R3-1) #539 (spec v3 反映) #712 (Phase 4-β embed 統一) #714 (runtime 契約 validator)

本書は画面項目定義 (画面 UI のフォーム項目に宣言的にバリデーション・ラベル・表示制御を紐付ける設計書) の仕様を定める。

## 位置づけ

バリデーションは 3 層構造 (#315 / #317 を経て確定):

| 層 | 担当 | 実装ステータス |
|---|---|---|
| **画面項目定義** (本書) | フォーム UI 関心事: 必須 / 長さ / フォーマット / エラーメッセージ | 未実装 (本書で策定) |
| **処理フロー** | 業務ロジック検証 (一意性 / 存在性 / 状態遷移) | 実装済 (#261 で 5/5 到達) |
| **横断規約** | 正規表現 / メッセージ / 制限値の再利用ライブラリ | 実装済 (#317 で UI 編集化) |

**境界のガイドライン**:
- フィールド単体で完結する制約 → 画面項目定義 (例: `required` / `maxLength` / `pattern`)
- 他フィールド・他レコードを跨ぐ検証 → 処理フロー (例: `unique(users, email)` / `stateTransition(from, to)`)
- 再利用可能な定数・テンプレート → 規約カタログ (例: `@conv.regex.phone-jp`)

## 論点と提案

以下 5 つの論点について叩き台の提案を示す。ユーザーレビューで合意後、v1.0 として凍結する。

---

### (A) データモデル

#### (A-1) ファイル配置: 画面ごとに独立 or 画面ファイル同梱

**案 A-1a 独立ファイル**: `data/screen-items/{screenId}.json` を別ファイルに
- ✅ 画面デザインと粒度を揃えて CRUD しやすい
- ✅ 既存の `data/screens/{id}.json` (GrapesJS 生データ) は触らず追加だけで済む
- ✅ wsBridge で `loadScreenItems` / `saveScreenItems` ハンドラを対称に追加できる
- ❌ **2026-05-03 reversal**: GrapesJS 視覚状態は `screens/<id>.design.json` に分離されたため「画面ファイルが肥大」懸念は解消。runtime 契約 (#711 / #712) も embed 形式のみを読むため独立ファイル運用は不可

**案 A-1b 画面同梱 (現行採用)**: `data/screens/{id}.json` に `items[]` を埋め込み
- ✅ runtime (`backend`) が直接 `Screen.items[]` を読む (legacy 配置は無視)
- ✅ 業務 (画面項目定義) と視覚 (`screens/<id>.design.json`) のファイル分離は別軸で達成済
- ✅ 1 画面 = 1 entity ファイル + 1 design ファイルで完結

→ **(A-1b) 画面同梱案** (Phase 4-β migration #712 で確定)

#### (A-2) 項目 1 件のスキーマ (v3)

一次成果物: [`schemas/v3/screen-item.v3.schema.json`](../../schemas/v3/screen-item.v3.schema.json)

```typescript
// v3 確定形 (frontend/src/types/v3/screen-item.ts と一致)
interface ScreenItem {
  /** 業務識別子 (Identifier、camelCase 強制、JS 識別子に直接使用可)。
   *  例: userName, postalCode、GrapesJS data-item-id と一致させる (#331 以降)。
   *  pattern: ^[a-z][a-zA-Z0-9]*$、maxLength: 64 */
  id: Identifier;
  /** 日本語表示名 (ラベル、エラーメッセージの {label} に使われる)。 */
  label: DisplayName;
  /** 型 (処理フロー FieldType と同一、common.v3 の FieldType $defs と整合)。 */
  type: FieldType;
  /** フォーム制御。 */
  required?: boolean;
  readonly?: boolean;
  disabled?: boolean;
  /** 文字列系制約。 */
  minLength?: number;
  maxLength?: number;
  /** 正規表現 (規約参照 `@conv.regex.*` または直接パターン)。 */
  pattern?: string;
  /** 数値系制約。 */
  min?: number;
  max?: number;
  step?: number;
  /** 選択系 (静的マスタ)。 */
  options?: Array<{ value: string; label: DisplayName }>;
  /** 規定値・プレースホルダ・ヘルプ。 */
  defaultValue?: string | number | boolean | null;
  placeholder?: string;
  helperText?: string;
  /** エラーメッセージ (`@conv.msg.<key>` 参照推奨)。
   *  キー: required / minLength / maxLength / invalidFormat / outOfRange / 任意のカスタムコード。 */
  errorMessages?: Record<string, string>;
  /** 表示制御 (式言語、`docs/spec/process-flow-expression-language.md` と共有)。 */
  visibleWhen?: ExpressionString;
  enabledWhen?: ExpressionString;
  /** 画面上での役割 (デフォルト: "input")。
   *  - "input"  = フォーム入力項目
   *  - "output" = 表示専用項目 (スカラー)
   *  - "viewer" = ViewDefinition の列定義を参照し、valueFrom で flow 変数から配列データを
   *               bind する配列データ表示項目 (#762)。viewDefinitionId が必須になる。 */
  direction?: "input" | "output" | "viewer";
  /** viewer 項目が参照する ViewDefinition の ID (#762)。
   *  direction='viewer' の場合のみ使用し、列定義・ソート・kind 等の viewer 設定を提供する。
   *  valueFrom.flowVariable で flow 変数から配列データを bind する。
   *  valueFrom 省略時は ViewDefinition の query を画面 mount 時に自動発行する (静的マスター一覧)。
   *  direction='viewer' の時のみ required。 */
  viewDefinitionId?: Uuid;
  /** 表示書式 (direction="output" 専用、例: "YYYY/MM/DD", "¥#,##0", "0.00%") — #377 */
  displayFormat?: string;
  /** バインド元 (direction="output" 専用) — #377、ValueSource は v3 で Pattern B 複合参照に変更。 */
  valueFrom?: ValueSource;
  /** 派生計算式 (= で始まる)。output 項目用。 */
  formula?: ExpressionString;
  /** 備考。 */
  description?: Description;
}

/**
 * v3 FieldType (common.v3 の $defs)。
 * - プリミティブ 7 種 (string / number / integer / boolean / date / datetime / json) — v3 で integer / datetime / json 追加
 * - 構造化型 (array / object / tableRow / tableList / screenInput / domain / file / extension) — v3 で domain / file / extension 追加、custom 廃止
 */
type FieldType =
  | "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "json"
  | { kind: "array"; itemType: FieldType }
  | { kind: "object"; fields: StructuredField[] }
  | { kind: "tableRow"; tableId: Uuid }
  | { kind: "tableList"; tableId: Uuid }
  | { kind: "screenInput"; screenId: Uuid }
  | { kind: "domain"; domainKey: string }              // PascalCase、context.catalogs.domains 参照
  | { kind: "file"; format?: string }
  | { kind: "extension"; extensionRef: string };       // namespace:fieldType 形式

/**
 * 出力項目のバインド元 (組み込み 4 種 + 拡張 1) — v3 で Pattern B 複合参照に変更。
 * - flowVariable.variableName は **IdentifierPath** (#533 R3-1) でドット区切り object field 参照可
 * - tableColumn / viewColumn は **TableColumnRef / ViewColumnRef** (Pattern B、物理名直書き廃止)
 */
type ValueSource =
  | {
      kind: "flowVariable";
      processFlowId?: Uuid;            // 省略時はカレント画面に紐付く ProcessFlow を解決
      variableName: IdentifierPath;    // 例: 'inventoryRows' / 'createdOrder.order_number' (#533 R3-1)
    }
  | { kind: "tableColumn"; ref: TableColumnRef }   // { tableId: Uuid, columnId: LocalId }
  | { kind: "viewColumn"; ref: ViewColumnRef }     // { viewId: Uuid, columnPhysicalName: PhysicalName }
  | { kind: "expression"; expression: ExpressionString }
  | {
      // 拡張 ValueSource (extensions.v3.valueSourceKinds で定義)
      kind: string;                    // namespace:identifier 形式 (例: 'retail:cartCalculation')
      config?: Record<string, unknown>;
    };
```

**v3 ファイル配置**:

ScreenItem は v3 schema 上 **Screen entity の `items[]` として埋め込み** (`schemas/v3/screen.v3.schema.json` の `Screen.items[]`)、runtime (`backend`) もこの形式のみ読む。

Phase 4-β migration (#712) で **embed 形式に統一**。`data/screen-items/{screenId}.json` の独立ファイル方式は廃止 (runtime 無視 + validator 警告 + 新規 workspace 作成時に未生成)。

**決定済み** (#330):
- `ScreenItem.name` は廃止。`id` が業務識別子 (実装コードのフィールド名) を兼ねる。
- `ScreenItem.id` (旧 UUID 識別子) は廃止。業務識別子を直接 id とする。
- `options` のようなマスタ依存項目 → **MVP は静的、後続でテーブル参照サポート**

**v3 で確定** (#525 / #533 / #539):
- `id` は **`Identifier`** (camelCase 強制、common.v3) としてブランド型化
- `valueFrom.flowVariable.variableName` は **`IdentifierPath`** (#533 R3-1) で object field 参照 (`createdOrder.order_number` 等) を schema 上許容
- `valueFrom.tableColumn` / `viewColumn` は **Pattern B 複合参照** に統一 (物理名直書き廃止)、`TableColumnRef` / `ViewColumnRef` ($defs in common.v3)
- `FieldType` の `kind: "custom"` は v3 で廃止、`extension` (namespace:identifier) で代替

---

### (B) 処理フローとの関係 — **#321 で実装着手**

処理フローの `inputs: StructuredField[]` と画面項目定義は重複する可能性がある。どう整合するか。

**✅ 採用: 案 B-1 処理フロー inputs が画面項目を参照** (PR #321 で実装、v3 で `ScreenItemRef` 型に確定):
- `StructuredField.screenItemRef?: ScreenItemRef` を追加 (v3: `{ screenId: Uuid, itemId: Identifier }`、common.v3 $defs)
- ProcessFlowEditor の入出力テーブルに「画面項目から追加」ボタン + `ScreenItemPickerModal`
- 参照時は ScreenItem から id/label/type/required/description を一回コピー (一方向)
- 参照解除ボタンで `screenItemRef` のみ削除、フィールドは残る
- **TODO (別 issue)**: 参照整合性バリデータ (UNKNOWN_SCREEN_ITEM)、参照後の画面項目更新を自動反映する双方向同期

(以降の代替案は履歴として残す)

**案 B-1 処理フロー inputs が画面項目を参照 (推奨、v3 確定形)**:
```json
{
  "action": {
    "name": "登録",
    "inputs": [
      {
        "name": "email",
        "type": "string",
        "screenItemRef": {
          "screenId": "3f378ca7-ad6f-44ad-8ebc-ab17fb806c2c",
          "itemId": "email"
        }
      }
    ]
  }
}
```
- 画面項目定義が正本、処理フロー側は参照のみ
- 画面項目で `required` / `maxLength` が定義されていれば処理フロー側は再宣言不要
- ✅ 二重管理を避けられる

**案 B-2 処理フロー inputs が画面項目と独立**: 従来通り
- シンプルだが drift 発生

→ **(B-1) 参照方式**

**決定済み** (#354):

- **[x] 処理フロー inputs の `required` / `description` 等との共存方法**:
  - ScreenItem が正本 (source of truth)。ProcessFlow inputs 側の同名フィールドは「参照時の一回コピー」として保持する。
  - `screenItemRef` が存在する場合、AI 実装コード生成時は ScreenItem の値を優先参照する。
  - ProcessFlow inputs 側のフィールド値が ScreenItem と異なる場合は「意図的な上書き」として扱い、AI が判断する。
  - ScreenItem が更新されても ProcessFlow inputs は自動同期しない (一方向コピーのまま)。差異の解決は実装時に AI が行う。

- **[x] 画面なしフロー (batch / scheduled) での `screenItemRef` 無しケースの扱い**:
  - `screenItemRef` の省略が正常ケース。バッチ・定時実行・イベント駆動などの画面なしフローでは `screenItemRef` を使用しない。
  - `screenItemRef` は任意フィールドであり省略が正常。lint/バリデータは `screenItemRef` の有無を問わない。

---

### (C) 規約カタログ連携

画面項目定義から `@conv.regex.*` / `@conv.msg.*` / `@conv.limit.*` を参照可能にする。

- `pattern`: 直接パターン or `@conv.regex.phone-jp` 参照
- `errorMessages.required`: `@conv.msg.required` 参照 (既定)
- `maxLength`: 直接数値 or `@conv.limit.nameMax` 参照

→ **#317 で追加した規約カタログを UI の datalist で補完**。画面項目エディタ側で `@conv.` typing 時に候補表示。これは画面項目編集 UI (別 issue) のタスク。

---

### (D) フレームワーク中立 → 実装展開

画面項目定義は**抽象的制約**のみ記述し、具象フレームワークコードには触れない。実装時に AI (Claude Code) が `docs/conventions/product-scope.md` のターゲットスタック宣言を読んで展開する。

| ターゲット | 展開例 (`required + maxLength: 100`) |
|---|---|
| SpringBoot (Bean Validation) | `@NotBlank @Size(max = 100)` アノテーション |
| React Hook Form + Zod | `z.string().min(1).max(100)` |
| Next.js Server Action | action 関数内で Zod validate → `{errors: {...}}` 返却 |

**要決定**:
- \[ \] `product-scope.md` に stack 宣言セクション (JSON 化 or markdown 構造化) を追加するか → **本 issue 範囲外、別 issue で**

---

### (E) 画面デザイナーとの UX 統合

#### (E-1) 編集画面の位置

**案 E-1a 独立タブ (推奨)**: `/screen/items/:screenId` で専用タブ
- 画面デザイナー (GrapesJS) とは別の一覧ビューで、1 項目 1 行テーブル形式 (規約カタログ UI と類似)
- GrapesJS 側で選択した要素の `data-item-id` が自動でハイライト / ジャンプ
- ✅ 一覧操作 (ソート / 一括編集) がしやすい
- ✅ 既存の singleton/per-resource タブ運用と整合

**案 E-1b インライン編集**: GrapesJS サイドバーで要素選択時に項目定義を出す
- 文脈的にはクリアだが、一覧操作がしにくい
- E-1a と両立可能 (後続で追加)

→ **MVP は (E-1a) 独立タブ、後続で (E-1b) も追加**

#### (E-2) GrapesJS ブロック配置時の属性自動入力 (#328 で実装済み)

GrapesJS で `input` / `select` / `textarea` ブロックを **drop したとき**に、以下の属性を自動付与する:

| 属性 | 値 | 条件 |
|---|---|---|
| `data-item-id` | 新規 UUID | 未設定の場合のみ |
| `name` | 種別+連番形式 (`textInput1`, `select2` 等) | 未設定の場合のみ。editor あり時 (#331 以降) |
| `name` | `field_<UUID先頭8文字>` | 未設定の場合のみ。editor なし時 (フォールバック) |
| `id` | name と同じ値 | 未設定の場合のみ |

**実装**: `frontend/src/grapes/dataItemId.ts` の `ensureFormFieldIdentity()` が `component:add` イベントで呼ばれる。  
**既存属性は絶対に上書きしない** (ユーザーが手で付けた name を壊さない)。  
`button` / `submit` / `reset` / `hidden` / `image` 型は対象外。  
種別+連番の prefix は `getItemIdPrefix(cmp)` で決定 (#331)。`isAutoGeneratedId(id)` が true の ID のみ上書き対象 (#333)。

#### (E-3) 既存画面からの移行

既存の `data/screens/{id}.json` には `data-item-id` が無い。migration:
- 画面を初めて編集するときに、既存ブロックから `name="email"` 等の属性を拾って自動で項目エントリを生成する提案 UI を出す
- ユーザーがラベルや required を埋めれば項目化完了

→ **migration は MVP で「空リストから手動追加」のみ、自動抽出は後続 issue**

---

## 実装の段階分割 (v1.0 確定後の後続 issue 候補)

1. **画面項目スキーマ + ストレージ + Backend** (projectStorage / wsBridge / Store)
2. **画面項目エディタ UI** (ScreenItemsView、ルーティング、HeaderMenu 配線)
3. **処理フロー inputs から screenItemRef 参照対応**
4. **GrapesJS ブロックとの `data-item-id` 紐付け + 選択連動**
5. **既存画面からの自動項目抽出 migration**
6. **実装コード生成 (Claude Code による Bean Validation / Zod 展開)**

MVP は 1-2-3 まで。4-5-6 は段階的に。

---

## ID リネーム時の参照追従仕様 (#332)

### 背景

画面項目 `id` は処理フローの `inputs[].screenItemRef.itemId` から参照される。
`id` を変更する場合、参照先が切れないよう **project 内の全処理フローを同時に書き換える** 必要がある。

### リネーム操作の仕様

| 項目 | 内容 |
|------|------|
| MCP ツール | `designer__rename_screen_item` (screenId / oldId / newId) |
| 確認ツール | `designer__check_screen_item_refs` (screenId / itemId) — 影響件数を dry-run で返す |
| 書き換え対象 | ① screen-items JSON の `items[].id`、② 画面 HTML の `name` / `id` 属性、③ 全処理フローの `screenItemRef.itemId` |
| 原子性 | ③ 処理フローは個別ファイルを逐次更新 (トランザクションなし。部分失敗時は再実行で冪等) |

### UI フロー

1. 画面項目定義画面で ID 欄を編集してフォーカスを外す
2. 変更前 ID への処理フロー参照が存在する場合: 確認ダイアログを表示
   - 追従される処理フロー名・件数を明示
   - 「リネーム実行」→ バックエンドが①②③を更新し、各コンポーネントへ broadcast
   - 「キャンセル」→ 入力を元の値に戻す
3. 参照なし: そのままコミット (ダイアログなし)

### バリデーション

| ルール | 結果 |
|--------|------|
| `newId` が空 | エラー: リネーム不可 |
| `newId` が無効な JS 識別子 (英字/_/$始まり、英数字/_/$のみ) | エラー: リネーム不可 |
| `newId` が同じ画面内の別 id と衝突 | エラー: リネーム不可 |
| `newId` が JS 予約語 (`let` / `const` 等) | 警告 (リネームは実行される) |
| `oldId` が存在しない | エラー |

### 参照走査の対象フィールド

- `ProcessFlow.actions[].inputs[].screenItemRef`
- `ProcessFlow.actions[].outputs[].screenItemRef`
- 上記のネスト (サブステップ / loop / branch 内) も再帰走査

### 対象外

- 処理フロー変数 (`@inputs.xxx` 形式の文字列参照) の rename → 後続 issue
- 一括リネーム (複数 id 同時変更) → リセット機能 issue で対応
- `label` フィールドは参照キーでないため rename refactoring 不要

---

## AI 推論による画面項目 ID 再命名 (#335)

### 背景

自動生成 ID (`textInput1`, `field_69f9561e` 等) を業務的に意味のある名前 (`userName`, `postalCode`) にするには LLM 推論が必要。API LLM を使わず **Claude Code の呼び出し元モデルが MCP tool 経由で推論・書き戻す** 方式を採る。

### 自動生成 ID の判定 (`isAutoGeneratedId`)

| パターン | 例 | 扱い |
|---|---|---|
| `field_[0-9a-f]{8}` | `field_69f9561e` | 自動生成 (上書き可) |
| `<prefix><数字>` | `textInput1`, `select3` | 自動生成 (上書き可) |
| それ以外 | `userName`, `postalCode` | 命名済み (保護) |

判定ロジックは `frontend/src/utils/screenItemNaming.ts` (#333) が正本。`backend` は独立パッケージのため `renameContext.ts` に複製して保持。

### MCP tool 仕様

#### `designer__get_rename_context`

- **入力**: `screenId: string`
- **出力**: `GetRenameContextResult`
  ```typescript
  interface GetRenameContextResult {
    screenId: string;
    unnamedItems: Array<{
      id: string;           // 現在の自動生成 ID
      type: string;         // screen-items の FieldType
      label?: string;       // screen-items のラベル
      placeholder?: string; // screen-items のプレースホルダー
      htmlFragment: string; // 周辺 HTML 断片 (前後 ~500/200 文字)
      headingContext: string[]; // 直前の見出し/legend テキスト (最大 3 件)
    }>;
    namedCount: number;     // 命名済み項目数 (参考)
  }
  ```
- **ロジック**: `isAutoGeneratedId(id)` が true の項目のみ返す。命名済みは含めない。

#### `designer__apply_rename_mapping`

- **入力**: `screenId: string`, `mapping: Record<string, string>` (`{oldId: newId}`)
- **出力**: `ApplyRenameMappingResult`
  ```typescript
  interface ApplyRenameMappingResult {
    screenId: string;
    succeeded: Array<{
      oldId: string; newId: string;
      screenHtmlUpdated: boolean;
      processFlowsUpdated: string[];
      refsRenamed: number;
      warnings: string[];
    }>;
    failed: Array<{ oldId: string; newId: string; error: string }>;
  }
  ```
- **ロジック**: 各エントリに対して `designer__rename_screen_item` を順次実行。1 件の失敗は後続を止めない。

### 命名規則 (呼び出し元プロンプトに含める)

- **形式**: camelCase / 英数字のみ / JS 予約語禁止 / 30 字以内
- **優先順位**: 画面の見出し → ラベル → placeholder → htmlFragment の順で文脈を参照
- **業務名の例**: `userName`, `postalCode`, `loginId`, `emailAddress`
- **推論不能な場合**: 自動採番形式 (`textInput1` 等) を維持 (無理に命名しない)

### 呼び出しフロー

```
呼び出し元 (Claude Code / skill / ボタン)
  1. get_rename_context(screenId) → unnamedItems
  2. 各 item を LLM で推論 → {oldId: newId} mapping 生成
  3. ユーザーに提示 → 確認
  4. apply_rename_mapping(screenId, mapping) → 結果報告
```

---

## 対象外 (本 spec v1.0 の範囲外)

- 動的依存 (フィールド A の値に応じて B の required が変わる 等) は `visibleWhen` / `enabledWhen` 式で最低限対応。より高度な依存ロジック表現は将来
- 多言語化 (`label` の i18n) は将来
- カスタムバリデータ (任意の JS 式) は処理フロー側で
- マスタ連動 (`options` がテーブル参照) は後続 issue

---

## 決定事項 (v1.0 確定内容)

### (A) データモデル
- **A-1** (v1.0 当初): 独立ファイル方式 (`data/screen-items/{screenId}.json`) を採用
- **A-1 (2026-05-03 reversal、#712)**: 独立ファイル方式を廃止し、`Screen entity` への embed (`screens/<id>.json#items[]`) のみに統一。runtime / validator / 新規 workspace 生成すべて embed 前提
- **A-2**: `ScreenItem` スキーマは上記の通り。一次成果物は `schemas/v3/screen-item.v3.schema.json`。`direction?: "input" | "output" | "viewer"` を追加 (#359 連動、#762 で "viewer" 追加)
- **A-3 (v1.1)**: `displayFormat?: string` / `valueFrom?: ValueSource` を追加 (#377)。`direction="output"` のときのみ使用。
  - `displayFormat`: 自由記述 + datalist 補完 (日付 / 数値 / 金額 / パーセント プリセット)
  - `valueFrom`: `flowVariable` / `tableColumn` / `viewColumn` / `expression` の組み込み 4 種 + 拡張 1 (`namespace:identifier`)。入力項目 (`direction="input"` または未設定) ではエディタに表示されない
- **A-4 (v3 反映)**: `id` を `Identifier` (camelCase) ブランド型化、`valueFrom.flowVariable.variableName` を `IdentifierPath` (#533 R3-1) で object field 参照可、`tableColumn` / `viewColumn` を Pattern B 複合参照 (`TableColumnRef` / `ViewColumnRef`) に統一、`FieldType.kind: "custom"` 廃止 → `extension` (namespace:identifier) で代替
- `name` は廃止、`id` が業務識別子を兼ねる (#330)

### (B) 処理フローとの関係
- **B-1**: 参照方式を採用 (`screenItemRef`) (#321)
- **共存ルール**: ScreenItem が正本。ProcessFlow inputs は一回コピー (一方向)。AI 実装時は ScreenItem 優先
- **画面なしフロー**: `screenItemRef` 省略が正常。バリデータは有無を問わない

### (C) 規約カタログ連携
- `@conv.regex.*` / `@conv.msg.*` / `@conv.limit.*` 参照可能
- 画面項目編集 UI で `@conv.` prefix 入力時に候補補完 (別 issue)

### (D) フレームワーク中立 → 実装展開
- 抽象制約のみ記述。`product-scope.md` stack 宣言は別 issue

### (E) 画面デザイナーとの UX 統合
- **E-1**: 独立タブ `/screen/items/:screenId` を MVP。GrapesJS インライン編集は後続
- **E-2**: ブロック配置時の `data-item-id` 自動付与 (#328 実装済み)
- **E-2b (canvas 双方向同期)**: ブロック drop → screen-items 自動追加、ブロック削除 → screen-items 自動削除。ロード後の reconcile で canvas と全件突合する。
  - **制約**: 「先に画面項目を定義してから canvas に配置する」ワークフローは、ロード後の reconcile で定義が削除される。データ損失を避けるには、先にブロックを配置してから項目を編集すること。
- **E-3**: 既存画面 migration は「空リストから手動追加」のみ。自動抽出は後続

---

## (F) viewer 項目 — 配列データ表示の宣言方式 (#762)

`direction: "viewer"` は、ViewDefinition の列定義を参照し、ProcessFlow の出力変数から配列データを
受け取って一覧表示するための screen-item 種別。検索結果一覧・マスター一覧・カート明細など
「配列を表で並べる」共通パターンをすべて同型で表現する。

### 基本構造

```jsonc
{
  "id": "propertyRows",
  "label": "物件一覧",
  "type": { "kind": "array", "itemType": "json" },
  "direction": "viewer",
  "viewDefinitionId": "<ViewDefinition の UUID>",  // 列定義・ソート・kind を提供
  "valueFrom": {
    "kind": "flowVariable",
    "processFlowId": "<ProcessFlow の UUID>",       // 検索/取得フロー
    "variableName": "rows"                         // フロー出力変数名
  }
}
```

### ユースケース例

#### 1. 検索フォーム + 検索結果一覧 (動的 binding)

ボタンクリック → handlerFlow 実行 → 結果を viewer に表示するパターン。

```jsonc
// 不動産: 物件検索画面
{
  "items": [
    {
      "id": "propertyType",
      "label": "物件種別",
      "type": "string",
      "direction": "input",
      "options": [
        { "value": "apartment", "label": "マンション" },
        { "value": "house", "label": "一戸建て" }
      ]
    },
    {
      "id": "maxPrice",
      "label": "上限価格 (万円)",
      "type": "integer",
      "direction": "input"
    },
    {
      "id": "searchButton",
      "label": "検索",
      "type": { "kind": "extension", "extensionRef": "realestate:button" },
      "direction": "output",
      "events": [
        {
          "id": "click",
          "handlerFlowId": "<物件検索フロー UUID>",
          "argumentMapping": {
            "propertyType": "@screen.propertyType",
            "maxPrice": "@screen.maxPrice"
          }
        }
      ]
    },
    {
      "id": "propertyRows",
      "label": "物件一覧",
      "type": { "kind": "array", "itemType": "json" },
      "direction": "viewer",
      "viewDefinitionId": "<物件一覧 VD UUID>",
      "valueFrom": {
        "kind": "flowVariable",
        "processFlowId": "<物件検索フロー UUID>",
        "variableName": "rows"   // フローが outputs[] で宣言した変数
      }
    }
  ]
}
```

#### 2. マスター一覧 (静的、valueFrom 省略)

`valueFrom` を省略すると、画面 mount 時に ViewDefinition の query が自動実行され、
結果を viewer に表示する (静的マスター一覧)。

```jsonc
{
  "id": "masterRows",
  "label": "マスター一覧",
  "type": { "kind": "array", "itemType": "json" },
  "direction": "viewer",
  "viewDefinitionId": "<マスター一覧 VD UUID>"
  // valueFrom 省略 → VD の query を mount 時に自動実行
}
```

#### 3. カート明細 (別フロー結果を binding)

```jsonc
{
  "id": "cartItems",
  "label": "カート明細",
  "type": { "kind": "array", "itemType": "json" },
  "direction": "viewer",
  "viewDefinitionId": "<カート明細 VD UUID>",
  "valueFrom": {
    "kind": "flowVariable",
    "processFlowId": "<カート集計フロー UUID>",
    "variableName": "cartItems"
  }
}
```

### 責務分離

| 要素 | 責務 |
|---|---|
| `ProcessFlow` | データ取得・業務ロジック (純粋関数性) |
| `ViewDefinition` | viewer 設定 (列・ソート・kind)、データ源は関心外 |
| `Screen.items[]` 内の viewer | 画面項目集合体 (input + output + viewer) の宣言 |

### validator 観点

`screenItemViewerValidator.ts` が次の観点を検出する (#762)。`validate:samples` で検出される (`npm run validate:samples -- <projectDir>`)。

| issue code | severity | 検出内容 |
|---|---|---|
| `MISSING_VIEWER_VIEW_DEFINITION` | error | `direction='viewer'` だが `viewDefinitionId` が無い |
| `UNKNOWN_VIEWER_VIEW_DEFINITION` | error | `viewDefinitionId` が同プロジェクト内の ViewDefinition に存在しない |
| `VIEWER_FLOW_VARIABLE_NOT_DECLARED` | warning | `valueFrom.variableName` が ProcessFlow の outputs / inputs / steps 出力に宣言されていない |
