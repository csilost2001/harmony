# 一覧画面の共通仕様

Issue: [#133](https://github.com/csilost2001/harmony/issues/133)
策定日: 2026-04-19

本ドキュメントは、一覧系画面の**操作・見た目・内部 API**の詳細仕様を定める。
イシュー #133 本文の「詳細仕様」としてリンクされる。

## 1. 目的

エディタ間で「クリック / 並び替え / 複数選択 / コピペ」等の挙動がバラバラになっている現状を、**Windows Explorer / Excel 準拠**の単一のパターンに統一し、内部実装も共通コンポーネントに集約する。

見た目 (カード / 表) は画面ごとに既定を維持しつつ、**切替可能**にする。エクスプローラの「詳細表示」と「アイコン表示」の関係と同じ。

## 2. 対象画面

| 機能名 | ルート | 既定表示 | 切替 UI |
|---|---|---|---|
| 画面一覧 | `/screen/list` | カード | カード ⇔ 表 |
| テーブル一覧 | `/table/list` | カード | カード ⇔ 表 |
| 処理フロー一覧 | `/process-flow/list` | カード | カード ⇔ 表 |
| テーブル定義 > カラム一覧 | `/table/edit/:id` 内のカラムタブ | 表 | 不要 |

### 画面フローの再定義

現在 `/screen/flow` 内で「フロー図 / 一覧」タブ切替となっているが、**2 機能に分離**する:

- **`/screen/flow`** = 画面フロー (画面遷移図)。キャンバス固定
- **`/screen/list`** (新設) = 画面一覧。他の一覧と同じ共通部品で実装

既存の `ScreenTableView` コンポーネントのロジックは新・画面一覧に移植。`FlowSubToolbar` の view mode 切替は削除。HeaderMenu に「画面一覧」を追加。CLAUDE.md の routing 表を更新。

## 3. 統一する操作

すべて **Windows Explorer / Excel 準拠**。迷ったら Excel の挙動を基準に実装する。

### 3.1 選択

表・カード共通。

| 操作 | 挙動 |
|---|---|
| クリック (単独) | 単一選択にリセット |
| Ctrl+ クリック | 選択のトグル (複数選択) |
| Shift+ クリック | アンカー (最後にクリックされた行) からクリック位置までの範囲選択 |
| Ctrl+A | 全選択 |
| Esc | 選択解除 |
| ダブルクリック | activate (編集画面へ遷移 等)。**クリックされた 1 行のみ**が対象。複数選択中でも、ダブルクリックされた行の `onActivate` が呼ばれる |
| 何もない領域のクリック | 選択解除 (ただし行クリックの誤認を避けるため、一覧コンテナの背景領域に限定) |

### 3.2 キーボード — 表レイアウト (list)

| キー | 挙動 |
|---|---|
| ↑ / ↓ | 選択を前 / 次の行に移動 (単一選択) |
| Shift+↑ / Shift+↓ | アンカーからの範囲を拡張 / 縮小 |
| Home / End | 先頭 / 末尾へ移動 |
| Ctrl+Home / Ctrl+End | 先頭 / 末尾へ移動し選択 |
| Enter / F2 | activate (単一選択時のみ) |
| Delete | 選択行を削除 (複数可、確認ダイアログあり) |
| Ctrl+C / Ctrl+X / Ctrl+V | コピー / 切り取り / 貼り付け (詳細 §3.4) |
| Ctrl+D | 選択行の複製 (直後に挿入) |
| Ctrl+A | 全選択 |
| Alt+↑ / Alt+↓ | 選択行を 1 つ上 / 下に移動 (D&D と同等、物理順変更) |
| Esc | 選択解除、コピー / カット状態の解除 |

### 3.3 キーボード — カードレイアウト (grid)

表レイアウトの上下キー以外は同じ。追加で **2D ナビゲーション**。

| キー | 挙動 |
|---|---|
| ↑ / ↓ | 上 / 下の行の近い列位置へ移動 |
| ← / → | 左 / 右のカードへ移動 |
| Shift+↑↓←→ | 範囲拡張 |

列数はウィンドウ幅によって動的に変わる。実装は `getBoundingClientRect()` で各カードの位置を取得し、現在カードの X 座標に最も近い上下行のカードを次の選択対象とする。行またぎの計算は:

1. 現在カードの `top` を取得
2. 現在カードより **top が大きい** (下の行にある) カードのうち `top` が最小のグループが「次の行」
3. その行で、現在カードの `left` に最も近いカードが移動先
4. ↑ は逆方向

画面リサイズで行列数が変わっても、この計算で自然に追従する。

### 3.4 クリップボード — コピペによる移動 / 複製

**ブラウザ内クリップボード** (内部 state) を使用。外部 (Excel 等) とは連携しない。

#### 挙動

| 操作 | 挙動 |
|---|---|
| Ctrl+C | 選択項目を**コピー**としてクリップボードへ。元の表示は変化なし |
| Ctrl+X | 選択項目を**切り取り**としてクリップボードへ。元の項目は**半透明表示** (opacity 0.5) になるが、貼り付けるまで物理的には削除されない |
| Ctrl+V | クリップボードの内容を**挿入位置**に挿入。切り取りなら移動 (元は削除)、コピーなら複製 |
| Esc | クリップボード破棄。ghosted 表示解除 |
| 新しい Ctrl+C / Ctrl+X | 前の内容は破棄 (上書き) |

#### 挿入位置ルール

貼り付け時の挿入位置は以下のルール:

1. **選択なし**: 末尾に挿入
2. **単一選択**: 選択行の**直後**に挿入
3. **複数選択 (連続)**: 最後の選択行の直後に挿入
4. **複数選択 (非連続)**: 物理順で最も後ろの選択行の直後に挿入
5. **貼り付け対象自身が選択中の場合** (Ctrl+X → 同じ選択のまま Ctrl+V): 何もしない (no-op)

切り取り→貼り付けが移動になる場合、**元の位置からは削除され、新しい位置に挿入**される。移動後は貼り付けた項目が選択状態になる。

#### クリップボード寿命

- **セッション (= タブ) 内のみ**: ページ再読み込みで消える
- **タブ間共有はしない**
- localStorage 等への永続化はしない

#### フィルタ / ソートとの相互作用

§3.6 / §3.7 を参照。

### 3.5 物理順の変更 (D&D)

| 操作 | 挙動 |
|---|---|
| 行 / カードをドラッグ | ドラッグ中は半透明表示、ドロップ先候補の位置にマーカー (線) 表示 |
| ドロップ | 物理順を書き換える |

- 表レイアウト: 行間に水平線のマーカー
- カードレイアウト: カード間に垂直線のマーカー (複数行に跨る場合、行内で判定)

D&D ハンドル:

- 表レイアウト: 行の左端にハンドル (`bi-grip-vertical`) を表示
- カードレイアウト: カード全体を掴めるようにする (ハンドル不要)

### 3.6 ソート (見た目だけ)

| 操作 | 挙動 |
|---|---|
| 列ヘッダクリック | その列で昇順ソート。再クリックで降順。3 回目クリックで解除 |
| **Shift+** 列ヘッダクリック | 第 2 / 第 3 ソートキーを追加 (多段ソート) |
| 既にソート中の列を通常クリック | 多段ソートを解除して、その列のみの単一ソートに |

#### 視覚表示

- ソート対象の列ヘッダに **▲ (昇順) / ▼ (降順)** アイコン
- 多段ソート時、アイコンの前に順位数字 **① ② ③** を表示
- ソートの状態が分かるよう、ヘッダの背景を薄く強調

#### 重要な制約

- **物理順は変更しない** (ソートは見た目のみ)
- **状態の永続化はしない** (画面を開き直すとリセット)
- **No 列は行に紐付いた永続フィールドとして描画される** (§3.10 参照)。ソート時、No は行と一緒に動くため、ソート順次第で `2, 5, 3, 1, 4` のように飛んで見える (これが正しい挙動)
- **ソート中は「並び替え Read-only モード」** に入り、物理順を変更する操作 (D&D / Alt+↑↓ / Ctrl+X→V / Ctrl+D / 新規作成 / 挿入) は無効化される (§3.9 参照)

### 3.7 フィルタ

共通処理を提供。各画面は**自分のフィルタ UI** (チェックボックス・検索ボックス等) を自由に実装し、共通フックに**述語関数 `(item) => boolean`** を渡す。

#### 共通コンポーネント

- `useListFilter<T>(items)` フック: フィルタ state + filtered 計算
- `<FilterBar>` コンポーネント: 「N 件 / 全 M 件 [フィルタクリア]」表示

#### 重要な制約

- **状態の永続化はしない** (今は)
- **フィルタ中も選択・D&D・コピペは動作する**
  - D&D / コピペは**絞り込まれた見える範囲内で操作**するが、物理順の変更は**隠れた項目の順序を壊さない**ように計算
  - 具体: 「filtered[i] を filtered[j] に移動」は「physical[ids[i].index] を physical[ids[j].index] の位置に移動」と解釈。隠れた項目は前後関係を維持
- **選択状態はフィルタ変更で失われない**が、フィルタで消えた項目が選択リストから除かれる
- **フィルタ中の Ctrl+A は「見えている項目の全選択」**

### 3.8 選択状態とソート / フィルタの相互作用

| 事象 | 挙動 |
|---|---|
| ソート適用 | 選択状態維持 |
| ソート解除 | 選択状態維持 |
| フィルタ適用 | 見えなくなった項目は選択から外れる |
| フィルタクリア | 選択状態維持 (再表示された項目は選択状態が復活**しない**) |
| ページ再読み込み | 選択状態リセット |

### 3.9 ソート中の Read-only モード

ソートがアクティブな間 (`sort.sortKeys.length > 0`) は、**並び替え Read-only モード**に入る。これは「一覧構造の編集」のみを対象とした制限であり、**行単位の内容編集 (ダブルクリック → 編集画面) は引き続き可能**。

#### 基本ルール

> **参照操作とクリップボード状態操作は可 / リストデータ変更は不可（Delete のみ例外）**

ソート中の画面では「行 3 を行 1 と行 2 の間にドロップ」しても、**物理順のどの位置にドロップしたのか**が定義できない。同様に貼り付け・複製・新規作成の「挿入位置」もソート中は不定義。一方、クリップボード状態の更新（Ctrl+C / Ctrl+X）は**実データを変更しない**ため許可。削除は**挿入位置の問題がなく** No の再採番が機械的に決定できるため例外的に許可。これにより「ソート = 表示モード / 手動並び = 編集モード」を排他的に明示する。Windows エクスプローラで「ソート中フォルダは D&D 並び替え不可」なのと同じ思想。

#### 操作ごとの挙動

| 操作 | ソート中 | 分類 |
|---|---|---|
| 行選択・フォーカス移動・スクロール | ✅ | 参照 |
| ダブルクリック / Enter → activate (編集画面へ) | ✅ | 参照（行内容編集は別世界） |
| Ctrl+C (コピー → クリップボード) | ✅ | クリップボード状態のみ |
| Ctrl+X (切り取り → クリップボード状態 + ghosted 表示) | ✅ | クリップボード状態のみ、実データ未変更 |
| Delete / 削除ボタン / 行ゴミ箱 | ✅ | リストデータ変更だが**例外**（挿入位置が不要、削除行以降を -1 で機械的に再採番） |
| Ctrl+V 貼り付け | ❌ | リストデータ変更（挿入位置不定義） |
| D&D 並び替え | ❌ (ハンドルをグレーアウト) | リストデータ変更（ドロップ先不定義） |
| Alt+↑↓ | ❌ | リストデータ変更（「上/下」不定義） |
| Ctrl+D 複製 | ❌ | リストデータ変更（挿入位置不定義） |
| 新規作成 (+ ボタン) / 挿入 | ❌ (ボタンをグレーアウト) | リストデータ変更（挿入位置不定義） |

#### Ctrl+X を許可する理由

Ctrl+X はクリップボード state に cut マーカーを入れるだけで、一覧データ本体は変化しない（ghosted 表示は純粋な表示効果）。実際のリスト変更は Ctrl+V で初めて起きる。この時点で paste は無効なので、データ破壊の可能性はない。むしろ「ソートで絞って該当行を探し、切り取ってからソート解除して貼り付ける」というワークフローが自然に成立するメリットがある（クリップボード状態はソート解除後も保持される、§3.4）。

#### 視覚表現

- ソート中は一覧上部に **SortBar** を表示 (§4.5, §5.9)
- 無効化された D&D ハンドル・ボタン類には `title="ソート中は無効 (ソート解除で利用可能)"` を付与

#### ソートの解除

- 列ヘッダクリック 3 回目で当該列のソートを解除 (§3.6)
- **SortBar の「ソート解除」ボタン**で全ソートキーを一括解除 (多段ソート時の主要動線)

#### なぜ「自動ソート解除」ではなく「操作無効化」か

以前の案では「物理順を変更する操作が走ったら自動でソートを解除して新しい物理順を見せる」方針だったが、却下。理由:
- 「行 3 を行 1 と行 2 の間にドロップ」のドロップ先物理位置が、ソート中は定義できない (解除前の画面と解除後の画面で対応が取れない)
- ユーザーの操作意図（「名前順で見てる途中でちょっと並べ替え」）と、「ソートが突然消える」というシステム挙動が一致しない
- 「ソート = 表示モード / 手動並び = 編集モード」を排他的に明示する方が、学習コストが低い

### 3.10 No 列 (永続フィールド)

表レイアウトの No 列は、**各行固有の `no: number` フィールド**として永続化される。

#### データモデル

各一覧系アイテム (`TableMeta` / `ScreenNode` / `ProcessFlowMeta` / カラム定義) は `no: number` を持つ。連番 1..N を厳密に維持し、隙間は作らない。

```ts
interface TableMeta {
  id: string;
  no: number;  // 1..N, 隙間なし
  name: string;
  // ...
}
```

#### 再採番タイミング

以下の物理順を変更する操作のたびに、全体を再採番 (1..N):

| 操作 | 再採番の内容 |
|---|---|
| D&D 並び替え | 移動元〜移動先の範囲を +1 / -1 シフト、移動対象を移動先の no に |
| Alt+↑↓ | 隣接行との no 交換 |
| Ctrl+X → V (移動) | 切り取り元削除相当 + 挿入位置に no 確保 |
| Ctrl+C → V (複製) | 挿入位置以降を +1、複製アイテムに挿入位置の no |
| Ctrl+D 複製 | 同上 |
| 新規作成 | 末尾に追加 (no = N+1) |
| 削除 | 削除行以降を -1 |

実装方針: どの操作も最終的に「物理順配列を書き換えた後、先頭から 1..N を振り直す」で十分。数十〜数百件規模では再採番コストは無視できる。

#### 表示

- 表レイアウト: `item.no` を直接描画 (レンダラの `index + 1` ではない)
- カードレイアウト: 表示しない (§4.2 既定)
- ソート時: `no` も他のフィールドと同様に行と一緒に動く。視覚的には `2, 5, 3, 1, 4` のように飛ぶ

#### マイグレーション

既存データ (各 JSON ファイル) に `no` フィールドがない場合、**読み込み時に配列の現在順で初期採番** (index 0 → no=1, index 1 → no=2, ...)。次回保存時に `no` フィールドが含まれるようになる。マイグレーションスクリプトは不要（読み込み時補完）。

#### なぜ永続フィールドにするのか

案 B（配列順 = 物理順、`no` はレンダラが `index + 1` で生成）は一見シンプルだが、「保存時には必ず物理配列を書き込み、ソート後配列は書き込まない」という暗黙の不変条件に依存する。将来いずれかの保存経路でソート後配列が書き込まれると、次のような破壊が静かに発生する:

1. **Git 差分が壊滅的になる** (全行の並びが毎回変わる)
2. **仕様書・帳票の出力順が毎回変わる** (ユーザーが設計した順序が失われる)
3. **他ブラウザタブとの同期順が揺れる**

`no` を明示フィールドにすれば、JSON 内の配列順は意味を持たなくなり、「保存しても並びが揺れない」が**設計時点で保証される**。実装の慎重さに依存しない。

### 3.11 削除操作の統一 (#147)

すべての一覧画面で **3 つの削除動線**を提供し、挙動を一致させる:

#### 3 つの削除動線

1. **行ごとのゴミ箱アイコン** (`bi-trash`) — 各行にホバー時表示、1 クリックでその行を削除マーク
2. **上部の削除アイコン** — 選択行をまとめて削除。選択ゼロ時は **disabled で常駐表示**
3. **右クリックメニューの「削除」項目** — 行を右クリック→コンテキストメニューから削除

いずれも §3.8 で規定された **ghost 方式** (`editor.markDeleted`) で処理。保存ボタンで確定するまでは削除候補が半透明表示されるのみ。直接 DB 削除は行わない。

#### 右クリックメニュー

**各行右クリック時の項目** (画面ごとにカスタマイズ):

| 画面 | 項目 |
|---|---|
| 画面一覧 / テーブル一覧 / 処理フロー一覧 | 新規作成 / コピー / 切り取り / 貼り付け / 複製 / 削除 |
| カラム一覧 (テーブル定義内) | カラム追加 / テンプレートから追加 / コピー / 切り取り / 貼り付け / 上へ / 下へ / 複製 / 削除 |

**項目はグルーピングして separator で分ける**: `[新規作成系] | [クリップボード系] | [移動系] | [削除]`。Windows / macOS のコンテキストメニュー標準に従う。

**空領域 (行が無い場所) の右クリック**: 「新規作成」のみの絞り込みメニューを出す (Windows エクスプローラ準拠)。選択行がある状態でも空領域を右クリックすると、そのメニューに切り替わる。

**キーボード代替**:
- **Menu キー** (Windows) または **Shift+F10** — 選択中の行 (または先頭行) の位置にコンテキストメニューを開く
- メニュー内: `↑ / ↓` で項目移動、`Enter` で実行、`Esc` で閉じる

#### §3.9 との整合 (ソート中 Read-only モード)

削除操作は §3.9 の例外として**ソート中も動作**する (位置不要、機械的に再採番可能)。右クリックメニュー内の項目は §3.9 に従って個別に有効・無効が切り替わる:

| メニュー項目 | ソート中 |
|---|---|
| 削除 | ✅ |
| コピー / 切り取り | ✅ (クリップボード状態のみ) |
| 新規作成 / 貼り付け / 複製 / 挿入 / 上へ / 下へ | ❌ (disabled, ツールチップで理由表示) |

SortBar と合わせて、ユーザーが「なぜ項目が無効なのか」を視覚的に把握できる。

## 4. 見た目

### 4.1 表レイアウト (エクスプローラの詳細表示)

- 列ヘッダ: 固定高、背景色で視覚的に区別、ソート対象列はハイライト
- 行: 1 行 1 項目、ホバー / 選択時のハイライト色を変える
- No 列 (最左): 右寄せ、等幅フォント
- D&D ハンドル: 行の先頭 (No 列の前)
- ダーク / ライト両対応 (`variant="light" | "dark"`)

### 4.2 カードレイアウト (エクスプローラのアイコン表示)

- グリッド配置 (CSS Grid `repeat(auto-fill, minmax(…))`)
- カード幅: 画面によって調整可能 (既定 280px)
- 各カード内のレイアウトは画面ごとにカスタム (カスタムレンダラ)
- No 列は**表示しない** (カードレイアウトでは非表示が自然)。ただし物理順はデータ側で保持
- 選択・ホバーの視覚表現は表と一貫したハイライト色
- カード全体が D&D ハンドル

### 4.3 切替 UI

- 一覧ヘッダ (ページタイトルの右) に、カード/表の**アイコントグル**を配置
  - アイコン例: `bi-grid-3x3-gap` (カード) / `bi-list-task` (表)
- 切替状態は **localStorage に永続化** (画面ごとに個別。キー: `list-view-mode:{feature-name}`)
  - 例: `list-view-mode:table-list`、`list-view-mode:action-list`
- 切替対象外の画面 (テーブル定義 > カラム一覧) にはトグル非表示

### 4.4 フィルタバー

- 一覧コンテナの上部 (`<FilterBar>`) に横長で配置
- フィルタが効いていれば表示、なければ非表示
- テキスト例: 「カテゴリ: 画面のみ — 3 件 / 全 10 件」+ 「フィルタクリア」ボタン

### 4.5 ソートバー (§3.9)

- 一覧コンテナの上部 (`<SortBar>`) に、FilterBar と同じ帯に配置
- ソート中 (`sort.sortKeys.length > 0`) のみ表示、解除時は非表示
- 多段ソート時は全キーを順序付きで表示 (昇順/降順アイコン付き)
- 「ソート解除」ボタンで全ソートキーを一括解除
- 注意書きで「ソート中は並び替え・新規作成・貼り付けが無効」を明示

```
┌──────────────────────────────────────────────────┐
│ 🔽 ソート中: 名前 ▲ → 更新日 ▼   [ソート解除]   │
│    並び替え・新規作成・貼り付けは解除後に可能    │
└──────────────────────────────────────────────────┘
```

- FilterBar と SortBar が両方出る場合は縦に並べて配置 (FilterBar が上、SortBar が下)

### 4.6 削除 UI (§3.11)

#### 行ゴミ箱アイコン

- 位置: 行の右端 (最後のカラムの後 or カード内右上)
- **ホバー時のみ表示** (opacity: 0 → 1 transition)。ノイズ最小、VS Code のタブ閉じるボタン等と一貫
- アイコン: `bi-trash`、色はセマンティック danger 系 (赤系)
- クリック時はその行を削除マーク (`editor.markDeleted([item.id])`)、他の行の選択状態は変更しない
- ソート中も有効 (§3.11 / §3.9)

#### 上部の削除アイコン

- 位置: ヘッダツールバーの固定位置 (各画面で統一)
- **disabled 常駐表示** (選択ゼロ時は視覚的に無効、予測可能な位置)
- アイコン + テキスト: `<i class="bi bi-trash" /> 削除` (選択時は件数併記: `削除 (N 件)`)
- クリック時は `editor.markDeleted(selection.selectedItems.map(id))`
- 選択ゼロ時の `disabled` は HTML の disabled 属性 + `tbl-btn-disabled` 等の共通クラス

#### 右クリックメニュー

- 発火: 行の右クリック、または空領域の右クリック
- 表示位置: カーソル位置。画面端をはみ出す場合は `flip` (上/左へ反転)
- 項目グルーピング: `[新規作成] | [クリップボード (コピー/切り取り/貼り付け)] | [移動 (カラム一覧のみ 上へ/下へ)] | [複製] | [削除]`
- separator: 水平線 1px (CSS `border-top`)
- 各項目: アイコン (16px) + ラベル (13px) + キーボードショートカット併記 (右寄せ、例: `Ctrl+C`)
- ソート中で無効な項目: `disabled` 属性 + `opacity: 0.4` + `title="ソート中は無効 (ソート解除で利用可能)"`
- キーボード: ↑↓ で移動、Enter で実行、Esc で閉じる
- フォーカス管理: メニューを開いた時に最初の有効項目にフォーカス。閉じた時は元の要素にフォーカスを戻す
- 外クリック / Esc / 項目クリック後は閉じる

## 5. API スケッチ

### 5.1 `useListSelection<T>` (既存・PR #138)

```ts
interface ListSelection<T> {
  selectedIds: Set<string>;
  selectedItems: T[];
  isSelected: (id: string) => boolean;
  setSelectedIds: (ids: Set<string>) => void;
  clearSelection: () => void;
  selectAll: () => void;
  handleRowClick: (id: string, e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  getAnchorId: () => string | null;
}

function useListSelection<T>(items: T[], getId: (item: T) => string): ListSelection<T>;
```

### 5.2 `useListKeyboard<T>` (既存 + 拡張)

```ts
interface ListKeyboardOpts<T> {
  items: T[];
  getId: (item: T) => string;
  selection: ListSelection<T>;
  clipboard?: ListClipboard<T>;
  /** "list" = 表レイアウト (↑↓のみ) / "grid" = カードレイアウト (↑↓←→) */
  layout?: "list" | "grid";
  /** grid レイアウト時の列数取得関数 (getBoundingClientRect ベース想定) */
  getColumnCount?: () => number;
  onActivate?: (item: T) => void;
  onDelete?: (items: T[]) => void;
  onDuplicate?: (items: T[]) => void;
  onMoveUp?: (items: T[]) => void;
  onMoveDown?: (items: T[]) => void;
  enabled?: boolean;
}

function useListKeyboard<T>(opts: ListKeyboardOpts<T>): void;
```

### 5.3 `useListClipboard<T>` (新設)

```ts
type ClipboardMode = "copy" | "cut";

interface ListClipboardState<T> {
  mode: ClipboardMode | null;
  items: T[];
}

interface ListClipboard<T> {
  clipboard: ListClipboardState<T>;
  hasContent: boolean;
  copy: (items: T[]) => void;
  cut: (items: T[]) => void;
  clear: () => void;
  /** 貼り付け実行時に呼ぶ。cut なら items を返して clear。copy なら items のディープコピーを返す */
  consume: () => T[];
  /** 指定 ID が「切り取り対象 (ghosted 表示)」か判定 */
  isItemCut: (id: string) => boolean;
}

function useListClipboard<T>(getId: (item: T) => string): ListClipboard<T>;
```

### 5.4 `useListFilter<T>` (新設)

```ts
interface ListFilter<T> {
  filtered: T[];
  isActive: boolean;
  totalCount: number;
  visibleCount: number;
  applyFilter: (predicate: ((item: T) => boolean) | null) => void;
  clearFilter: () => void;
}

function useListFilter<T>(items: T[]): ListFilter<T>;
```

### 5.5 `useListSort<T>` (新設)

```ts
interface SortKey {
  columnKey: string;
  direction: "asc" | "desc";
}

interface ListSort<T> {
  sortKeys: SortKey[];
  sorted: T[];
  toggleSort: (columnKey: string, opts?: { addKey?: boolean }) => void;
  clearSort: () => void;
  getSortRank: (columnKey: string) => number | null;  // 多段ソート時の順位 (1-indexed)
  getSortDirection: (columnKey: string) => "asc" | "desc" | null;
}

function useListSort<T>(
  items: T[],
  getSortAccessor: (item: T, columnKey: string) => string | number,
): ListSort<T>;
```

### 5.6 `DataList<T>` (差し替え)

```ts
interface DataListColumn<T> {
  key: string;
  header: ReactNode;
  render: (item: T, index: number) => ReactNode;
  width?: string;
  align?: "left" | "center" | "right";
  className?: string;
  sortable?: boolean;
  sortAccessor?: (item: T) => string | number;
}

interface DataListProps<T> {
  items: T[];
  columns: DataListColumn<T>[];
  getId: (item: T) => string;
  /** No 列表示用 (§3.10)。省略時は index + 1 にフォールバック */
  getNo?: (item: T) => number;
  selection?: ListSelection<T>;
  clipboard?: ListClipboard<T>;
  sort?: ListSort<T>;
  onActivate?: (item: T, index: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** 行の削除ボタン (行ゴミ箱, §3.11 / §4.6)。指定時のみ各行右端にホバー表示 */
  onRowDelete?: (item: T) => void;
  /**
   * 右クリックメニュー (§3.11 / §4.6)。行または空領域の右クリック時に呼ばれる。
   * item=null は空領域 (背景) の右クリック。実装側が項目配列を返し、DataList が
   * ListContextMenu を開く
   */
  onContextMenu?: (e: ReactMouseEvent, item: T | null) => void;
  /** レイアウト。"list" = 表、"grid" = カード */
  layout?: "list" | "grid";
  /** grid レイアウト時のカードレンダラ (columns は使われない) */
  renderCard?: (item: T, index: number) => ReactNode;
  showNumColumn?: boolean;
  emptyMessage?: ReactNode;
  className?: string;
  variant?: "light" | "dark";
}

function DataList<T>(props: DataListProps<T>): ReactElement;
```

### 5.7 `<FilterBar>` (新設)

```tsx
interface FilterBarProps {
  isActive: boolean;
  totalCount: number;
  visibleCount: number;
  /** "カテゴリ: 画面のみ" のような現在のフィルタ条件説明 */
  label?: string;
  onClear: () => void;
}

function FilterBar(props: FilterBarProps): ReactElement | null;
```

### 5.8 `<ViewModeToggle>` (新設)

```tsx
interface ViewModeToggleProps {
  mode: "card" | "table";
  onChange: (mode: "card" | "table") => void;
  /** localStorage への永続化キー */
  storageKey?: string;
}

function ViewModeToggle(props: ViewModeToggleProps): ReactElement;
```

### 5.9 `<SortBar>` (新設, §3.9 / §4.5)

```tsx
interface SortBarProps<T> {
  sort: ListSort<T>;
  /** columnKey → ヘッダ文字列への辞書 (表示用ラベル解決) */
  columnLabels: Record<string, string>;
}

function SortBar<T>(props: SortBarProps<T>): ReactElement | null;
```

`sort.sortKeys.length === 0` の時は `null` を返す (非表示)。`DataList` の `sort` prop / `useListKeyboard` は `sort.sortKeys.length > 0` を Read-only モード判定に使用する。

### 5.10 `<ListContextMenu>` (新設, §3.11 / §4.6)

```tsx
interface ContextMenuItem {
  /** 一意キー (React key) */
  key: string;
  /** 表示ラベル。省略 + separator=true でセパレータとして動作 */
  label?: string;
  /** Bootstrap Icons クラス名 (例: "bi-trash") */
  icon?: string;
  /** キーボードショートカット表示 (右寄せ、例: "Ctrl+C")。動作は結び付けない (既存 useListKeyboard に任せる) */
  shortcut?: string;
  disabled?: boolean;
  /** disabled 時の説明 (tooltip 用) */
  disabledReason?: string;
  /** true ならセパレータ (水平線)。label / icon / onClick は無視される */
  separator?: boolean;
  /** 破壊的操作 (削除系) の視覚強調。true で danger スタイル (赤系ハイライト) */
  danger?: boolean;
  onClick?: () => void;
}

interface ListContextMenuProps {
  items: ContextMenuItem[];
  /** 表示座標 (CSS px)。clientX / clientY 相当 */
  x: number;
  y: number;
  onClose: () => void;
}

function ListContextMenu(props: ListContextMenuProps): ReactElement;
```

- items 配列に separator を含めて渡すと、そのまま順序通り描画される
- キーボード: 上下で移動 (disabled 項目はスキップ)、Enter で実行、Esc で閉じる
- 外クリックで閉じる。画面端をはみ出す場合は反対側にフリップ
- 開いた時は最初の非 disabled 項目にフォーカス、閉じた時は元の要素にフォーカスを戻す

### 5.11 画面側の使用イメージ

```tsx
function TableListView() {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [viewMode, setViewMode] = usePersistentState<"card" | "table">("list-view-mode:table-list", "card");
  
  const filter = useListFilter(tables);
  const sort = useListSort(filter.filtered, (item, key) => getSortAccessor(item, key));
  const selection = useListSelection(sort.sorted, (t) => t.id);
  const clipboard = useListClipboard<TableMeta>((t) => t.id);
  
  useListKeyboard({
    items: sort.sorted,
    getId: (t) => t.id,
    selection,
    clipboard,
    layout: viewMode === "card" ? "grid" : "list",
    onActivate: (t) => navigate(`/table/edit/${t.id}`),
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
  });
  
  return (
    <div>
      <Header>
        <h2>テーブル設計書</h2>
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </Header>
      
      <MyFilterUI onChange={(pred) => filter.applyFilter(pred)} />
      <FilterBar {...filter} onClear={filter.clearFilter} />
      <SortBar sort={sort} columnLabels={columnLabels} />
      
      <DataList
        items={sort.sorted}
        columns={columns}
        getId={(t) => t.id}
        selection={selection}
        clipboard={clipboard}
        sort={sort}
        layout={viewMode === "card" ? "grid" : "list"}
        renderCard={renderTableCard}
        onActivate={(t) => navigate(`/table/edit/${t.id}`)}
        onReorder={handleReorder}
      />
    </div>
  );
}
```

## 6. 技術方針

### 6.1 ライブラリ選定

- **TanStack Table (MIT)** — headless table。row model / 列管理 / ソート / フィルタのエンジンとして活用。レンダリングはしないので、カード表示にも同じデータモデルを流用できる
- **`@dnd-kit`** — 既にプロジェクトで使用中。そのまま継続
- **選択 / キーボード / コピペ / フィルタ / ソート は自作フック** — 細かい UX をコントロールするため

### 6.2 TanStack Table の使い所

- sort state 管理 (PR #138 の useListSort は TanStack の sorted row model に差し替え可能)
- 列定義の型 (`ColumnDef<T>`)
- カラム visibility / ordering (将来用)
- row model をカードレイアウトにも流用

### 6.3 移行方針

PR #138 で作った自作 `DataList` / `useListSelection` / `useListKeyboard` は Phase A で TanStack ベースに差し替えるが、**対外 API は互換を保つ**ことを目標にする (既存使用箇所を壊さないため)。

## 7. Phase 分け (各 Phase = 1 PR)

| Phase | 内容 | 視覚影響 | 規模 |
|---|---|---|---|
| A | TanStack Table 導入 + 共通フック完全版 (選択・キー・コピペ・フィルタ・ソート) + `DataList` 差し替え + `<FilterBar>` + `<ViewModeToggle>` + カード版レンダラ対応 | ゼロ (基盤のみ) | 大 |
| B | テーブル定義 > カラム一覧を共通部品に移行 | 小 (既に表、微調整) | 中 |
| C | 画面一覧の新設 (画面フローから分離、HeaderMenu・CLAUDE.md 更新) | 中 (新機能・新タブ) | 中 |
| D | 処理フロー一覧を共通部品化 + カード/表切替追加 | 中 (切替 UI 追加) | 中 |
| E | テーブル一覧を共通部品化 + カード/表切替追加 | 中 (切替 UI 追加) | 中 |

各 Phase は独立した PR として作成・レビュー・マージ。視覚影響のある B〜E は AI が chrome-devtools MCP / Playwright で smoke test を実施した上でマージ。

## 8. 受け入れ条件

- [ ] 共通フック (`useListSelection` / `useListKeyboard` / `useListClipboard` / `useListFilter` / `useListSort`) が提供され、Vitest で主要ケースが検証されている
- [ ] `DataList` が TanStack ベースで table / grid 両レイアウトを表示できる
- [ ] 対象 4 画面すべて (画面一覧 / テーブル一覧 / 処理フロー一覧 / テーブル定義 > カラム) が共通部品を使っている
- [ ] カード ⇔ 表切替が機能し、状態が localStorage に画面ごと永続化される
- [ ] Excel/Explorer 準拠の操作が全画面で統一動作:
  - クリック / Ctrl+ / Shift+ / Ctrl+A / Esc / ダブルクリック
  - ↑↓ (表) / ↑↓←→ (カード) / Shift+ 拡張
  - Enter / F2 / Delete / Ctrl+C/X/V/D / Alt+↑↓
- [ ] No 列が `item.no` 永続フィールドとして表レイアウトに描画される (レンダラの `index + 1` ではない)
- [ ] 各一覧系アイテムに `no: number` が追加され、D&D / Alt+↑↓ / Ctrl+X→V / Ctrl+C→V / Ctrl+D / 新規作成 / 削除 で連番 1..N が厳密に維持される
- [ ] `no` フィールドが存在しない既存データは、読み込み時に配列現在順で初期採番される
- [ ] ソート中 (`sort.sortKeys.length > 0`) は「並び替え Read-only モード」に入り、D&D ハンドル / Alt+↑↓ / Ctrl+V / Ctrl+D / 新規作成 / 挿入 が無効化される (§3.9)
- [ ] ソート中も Delete / Ctrl+C / Ctrl+X / 選択 / activate は動作する (Ctrl+X はクリップボード状態のみ更新、実データ未変更)
- [ ] `<SortBar>` がソート中に表示され、多段ソートキーの可視化と「ソート解除」ボタンを提供する
- [ ] 列ヘッダクリックソート (単一・多段 Shift+ クリック) が動作。▲▼ と順位 ① ② ③ が表示される
- [ ] フィルタ API が動作し、`<FilterBar>` が共通で利用できる
- [ ] 画面フローと画面一覧が分離され、HeaderMenu・ルーティング・CLAUDE.md が更新されている
- [ ] Playwright テストが主要一覧 (特に画面一覧・テーブル一覧) に追加または更新されている
- [ ] 行ごとのゴミ箱アイコンが各一覧の各行に**ホバー時表示**され、クリックで削除マーク (§3.11 / §4.6)
- [ ] 上部の削除アイコンが各一覧の共通位置に **disabled 常駐**、選択時は有効化 (複数選択対応、件数表示)
- [ ] 右クリックメニュー (`<ListContextMenu>`) が各一覧で動作。画面別項目・グルーピング・キーボード代替 (Menu / Shift+F10 / ↑↓ / Enter / Esc)
- [ ] 空領域の右クリックで「新規作成」のみの絞り込みメニューが出る
- [ ] ソート中は右クリックメニューの「新規作成 / 貼り付け / 複製 / 挿入 / 上へ / 下へ」が個別 disabled、「削除 / コピー / 切り取り」は引き続き有効

## 9. スコープ外 (将来対応)

- ブラウザ外 (Excel 等) クリップボードとの連携 (ペースト機能)
- ソート / フィルタ状態の永続化
- 仮想スクロール (現状の件数規模では不要)
- 列幅のユーザーカスタマイズ・永続化
- 列の表示/非表示カスタマイズ
- グループ化表示
- カラム順序のユーザーカスタマイズ

将来これらが必要になったとき、TanStack Table ベースの採用により拡張しやすい。

## 10. Excel / Explorer 参照動作 (迷った時の拠り所)

実装中に仕様が曖昧な箇所に遭遇したら、以下の順で判断する:

1. Excel で同じ操作をしたらどうなるか
2. Windows エクスプローラの「詳細表示」または「大アイコン表示」で同じ操作をしたらどうなるか
3. それでも決まらない場合は、**ユーザーに確認する** (勝手にスコープを縮退させない)

## 11. 変更履歴

- 2026-04-19: 初版。#133 の当初方針 (「カード → 表に一律変更」) をスコープ再定義 (「表/カード併存、切替提供、共通実装」) して本仕様を策定。PR #139 (誤った方向の実装) クローズ、PR #138 (共通基盤) を本仕様の Phase A で TanStack ベースに差し替え
- 2026-04-19: #148 対応により §3.6 の「物理順変更操作はソート中も許可 / 自動解除推奨」方針を撤回。代わりに §3.9「ソート中 Read-only モード」と §3.10「No 列 (永続フィールド)」を新設。`<SortBar>` を §4.5 / §5.9 に追加。受け入れ条件を更新
- 2026-04-19: #147 対応により §3.11「削除操作の統一」と §4.6「削除 UI」を新設。`<ListContextMenu>` を §5.10 に追加 (既存 §5.10 は §5.11 に繰り下げ)。`DataList` に `onRowDelete` / `onContextMenu` / `getNo` プロップを追加。受け入れ条件に 5 項目追加
