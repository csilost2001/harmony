# ドラッグ・直接操作・一括 — 仕様書 (UI 改善提案 第 3 弾)

**Status**: 実装済 (2026-10、ISSUE #1512)
**関連**: [ui-keyboard.md](ui-keyboard.md) / [ui-input-assist.md](ui-input-assist.md) / [ui-markers.md](ui-markers.md) / [screen-layout.md](screen-layout.md) / [list-common.md](list-common.md) / [references.md](references.md)

見ているものを直接触る。まとめて選び、まとめて変える。**原本 (設計の JSON) の形は変えない** (スキーマ変更なし)。ドラッグできる操作は、すべてマウスなしの代替を持つ (`scripts/verify/drag-alternatives.json`。台帳の検査は `npm run check` に含まれる)。キー操作の一覧は「?」のショートカット一覧 (`utils/shortcuts.ts`)。

## 1. 画面デザイナ (業務部品デザイナ)

| 操作 | 内容 | 実装 |
|---|---|---|
| 文言をその場で直す (#41) | 部品をダブルクリック / **F2**。対象: 見出し・文章・ボタン・リンク・区画 / フォーム / 検索条件 / タブの表題・項目の表示名 (項目の定義に書く)・一覧表の表題。**Enter** 確定 (文章は Shift+Enter で改行)・**Esc** 取り消し・**Tab / Shift+Tab** で次 / 前の文言へ。日本語変換中は確定しない | `layoutInline.ts` / `LayoutCanvas.tsx` (InlineEditor) |
| 右クリックのメニュー (#42) | 右クリック / **Shift+F10** / メニューキー / タッチの長押し。文言を直す・複製・前へ / 後ろへ・親の外へ / 直前の部品の中へ・区画 / フォーム / ボタン群で包む・独自部品として登録・展開・削除 | `ScreenLayoutDesigner.tsx` (menuItems) / `ListContextMenu` |
| 複数選択と一括操作 (#43) | **Ctrl / Cmd+クリック** = 選択に加える / 外す、**Shift+クリック** = 同じ入れ物の中の範囲、**Shift+↑↓** = 前後へ広げる、**Ctrl+A** = 同じ入れ物の中すべて。右パネルが一括の操作になる: 複製・削除・上へ / 下へ・入れ物で包む・共通の属性 (入出力・必須・読み取り専用・フォームの列数・ボタンの強調)。Ctrl+D / Delete / Alt+↑↓ も、まとめて効く。親も選ばれている部品は、親だけを数える | `layoutSelection.ts` / `LayoutMultiPanel.tsx` / `useLayoutOps.ts` |
| 段の幅をドラッグ (#44) | 段 (段組の中) の右端の境界をドラッグ → 右隣の段との配分が変わる (合計は不変、どちらも 1 以上)。ドラッグ中は「6 : 6」と出る。**Alt+Shift+←→** で 1 つぶん。右の「幅 (12 分割)」と相互に反映 | `layoutResize.ts` / `LayoutCanvas.tsx` (ColumnHandle) |
| 属性だけコピー & 貼り付け (#54) | 項目を選んで「属性をコピー」→ 別の項目 (複数でも) を選んで「属性を貼り付け…」→ 貼る属性にチェック (元で設定されているものに最初から印。「型」は自分で選んだときだけ。元で未設定の属性は、貼り先でも未設定に戻す)。アプリ内の入れ物なので、別の画面へも貼れる | `utils/itemAttrs.ts` / `AttrClipboardBar.tsx` |
| ドラッグの知らせ (#45・#58) | 別の入れ物へ移したとき「…の中へ移しました (Ctrl+Z で戻せます)」。1 回のドロップ = 1 回の Ctrl+Z。紙面の上下の端へ寄せると自動でスクロール。Esc でドラッグを取りやめ (ブラウザの標準) | `useLayoutOps.ts` / `LayoutCanvas.tsx` |

新しい部品 ID・選択は、いまの内容から先に決める (`apply` の中で決めた値を、すぐ後の選択に使わない。React が更新を後から実行することがあるため)。

## 2. 一覧・表

| 操作 | 内容 | 実装 |
|---|---|---|
| 列の幅・表示・並びを覚える (#47) | 表表示の一覧 (`DataList` に `prefsKey` を渡したもの) で、見出しの右端のドラッグ = 幅 (ダブルクリックで自動)、見出しのドラッグ = 並び、右クリック / 右上の「列の設定」= 表示のチェック・並びの ↑↓・幅の数値・既定に戻す。**このブラウザ (localStorage) に、一覧ごとに覚える** (原本には書かない)。最後の 1 列は隠せない | `utils/columnPrefs.ts` / `useColumnPrefs.ts` / `ColumnPrefsMenu.tsx` |
| 行のドラッグ並べ替え (#48) | 画面項目の表・テーブルのカラム (表で編集)・ビュー定義のカラムで、行頭のつまみをドラッグ (落とす位置は線で示す。端へ寄せると自動スクロール)。**Alt+↑↓** でも 1 つずつ。展開・選択の印は行についていく | `useRowDragReorder.ts` / `utils/rowReorder.ts` / `useGridKeyboard` (onMoveRow) |
| オートフィル (#53) | 入力欄を選ぶと、セルの右下に四角が出る → 上下へドラッグして、その欄の値を埋める。**Ctrl を押しながら**で、末尾の数字 (item1 → item2)・日付 (2026-10-30 → 31 → 11-01) を 1 つずつ進める。キーボードは Ctrl+D (1 つ上の値を写す) | `GridFillHandle.tsx` / `utils/gridFill.ts` |
| 条件で選ぶ (#57) | 一覧の右上「条件で行を選ぶ」: 列 (並べ替えに使える列) と条件 (含む・同じ・空・空でない・いま選んでいる行と同じ) → 該当数を見て、「選ぶ」「選択に加える」「選択から外す」。全角半角・かなの違いは無視。選んだ行は、削除・一括変更・コピーにそのまま使える | `utils/selectByCondition.ts` / `SelectByConditionMenu.tsx` |
| 他のアプリ・AI へ渡す (#52) | 一覧の右上「表としてコピー」: 選んだ行 (無ければ見えている行すべて) を、**Markdown の表 / TSV (Excel に貼れる) / JSON** で OS のクリップボードへ。画面に出ている列のうち、値を取れる列だけ | `utils/tableExport.ts` |
| 行を入力欄へドラッグ (#51) | 一覧の行 (表表示) を、参照の補完つき入力欄へドラッグ → カーソルの位置に `@table.orders` のような参照が入る。**並べて表示の右側の一覧 → 左の編集画面**でも同じ。キーボードは「表としてコピー」→「選んだ行の参照 (@…) をコピー」→ 入力欄へ貼り付け。対象: 画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト・処理フローの一覧 (カード表示は対象外) | `utils/refDrag.ts` / `useReferenceCompletion.ts` / `DataList` (dragRef) |

## 3. 図・タブ・ファイル

| 操作 | 内容 | 実装 |
|---|---|---|
| 図の拡大縮小 (#56) | ER 図・画面フロー: **+ / −** 拡大 / 縮小、**0** 等倍、**F** 全体を収める、**Z** 選んでいる部品へ寄る (図の上にフォーカスがあるとき。何もない所をクリックするとフォーカスが移る)。ER 図は左下にボタンと倍率。ミニマップは両方にある | `DiagramControls.tsx` |
| ER 図でカラムから線 (#49) | 編集中、カラムの行の左右の端のつまみ (行に重ねると見える) から別のテーブルのカラムへ線を引く → 「リレーション追加」に、両方のカラムが入った状態で開く。型の仲間が違えば警告 (追加はできる)。**作るのは論理リレーション** (ER の配置情報)。物理の外部キー制約は、テーブル編集の「制約」 | `ErTableNode.tsx` / `utils/columnTypeCompat.ts` |
| 画面フローで線 (#50) | 線を引いた直後に、その場で遷移ラベルの入力欄 (Enter 確定・Esc スキップ)。**何もない所へ線を落とす**と、画面の追加ダイアログが開き、その位置に新しい画面を作って、つなぐ | `FlowEditor.tsx` |
| タブを右へドラッグして並べる (#55) | タブを本文の右 4 割へドラッグ → 領域が光り、離すと右側に並べて表示 ([ux-operations.md](ux-operations.md))。キーボードは、タブの右クリックメニューの「右側に並べて表示」。いま開いているタブは並べられない | `store/splitDropStore.ts` / `TabBar.tsx` |
| ファイルをドロップして取り込み (#46) | 画面のどこへでも .sql / .ddl (DDL → テーブル)・.json (OpenAPI → 処理フローの骨組み) をドロップ → 「連携と運用 → 取り込み」が開き、内容が入って予行が出る (まだ何も作らない)。.xlsx は案内だけ。ファイル選択・文の入力欄の上へのドロップは、その欄に任せる | `shell/FileDropImport.tsx` / `store/pendingImport.ts` |
| タッチ・ペン (#59) | 一覧の行・画面デザイナの部品の**長押し (約 0.55 秒)** = 右クリックのメニュー (指が動いたら開かない)。段の幅・オートフィルの操作はポインタイベントで、タッチでも使える。ドラッグの代わりは、台帳のとおり | `hooks/useLongPress.ts` |

## 4. 参照の付け替え (#60)

「参照元」ダイアログ →「別の対象へ付け替える…」。この設計 (A) を参照している設計のうち**選んだもの**の、A への参照を、別の設計 (B) の参照にする。**A は残る** (改名とは別)。

- 単位は参照元の設計 (ファイル) ごと。選んだ設計の中の A への参照は、すべて B になる。予行で、設計ごとの数と、付け替え先の候補・注意・止める理由 (参照元を編集中の人がいる) が出る
- 実行は、書き換える前の版を残し (`.harmony-backups`)、途中で失敗したら元に戻す。**5 分以内**なら「元に戻す」で戻せる (付け替えのあとに、その設計が編集されていたら戻さない)
- 対象外: 業務フロー・帳票の参照 (予行の注意に出す)、図の座標・プロジェクト設定・独自部品の定義、A 自身の中の自己参照
- 実装: `backend/src/replaceReferences.ts` (改名と同じ参照の走査 `scanAllRefs`) / RPC `previewReplaceReferences` `replaceEntityReferences` `undoReplaceReferences` / MCP `designer__replace_references` (既定は予行。`referrers` で参照元を選び `apply: true`) と `designer__undo_replace_references` / UI `ReplaceReferencesPanel.tsx`

## 5. 見送り・一部だけのもの (提案文からの差)

- **#44**: 寸法のドラッグは、段の幅 (12 分割) だけ。フォームの列数・余白・間隔は、画面デザイナの部品に座標・余白の値を持たないため、右の欄 (列数の 1〜4) のまま
- **#42**: 右クリックのメニューに、「別画面へコピー」「マーカーを付ける」は入れていない (画面デザイナの部品へのマーカーは、画面項目の表・右パネル側)
- **#52**: 外へ渡す (コピー) だけ。外から貼り付けて読む形式は、画面項目の「項目を貼り付け」・カラムの「カラムを貼り付け」(既存) まで
- **#53**: 1 つのセルから、上下の行への埋め込み。範囲を選んでの埋め込みは未対応 (Ctrl+D と同じく 1 つずつ)
- **#49**: 作るのは論理リレーション (ER の配置情報)。物理の外部キー制約の作成は、テーブル編集の「制約」
- **#58**: ドラッグの取り消しは、1 回のドロップ = 1 回の Ctrl+Z。わずかな動きの無視は、各ドラッグの標準の閾値 (dnd-kit は 4〜8px、ブラウザのドラッグは数 px) のまま
- **#59**: タッチでの HTML5 ドラッグ (パレットからの部品の追加・紙面での移動) は、ブラウザの対応に依存する。代わりは、パレットのタップ・右クリックのメニュー・Alt+矢印のボタン

## 6. 試験

- 単体: `layoutSelection` / `layoutInline` / `layoutResize` / `columnPrefs` / `gridFill` / `rowReorder` / `selectByCondition` / `tableExport` / `refDrag` / `itemAttrs` / `columnTypeCompat` / `splitDropStore` / `pendingImport` / `useLongPress`、backend `replaceReferences.test.ts` (予行・実行・取り消し・編集中・自己参照) / `handlers/design.test.ts` (MCP)
- E2E: `layout-direct-manipulation` / `list-column-prefs` / `grid-fill` / `row-reorder` / `diagram-controls` / `flow-direct-connect` / `file-drop-import` / `replace-references`、`ux-operations` (タブのドラッグ・行を入力欄へ)、`business-flow` (ドラッグ中の Esc)
