// #1374: editSession__create / editSession__list の resourceType enum を、
// editSessionStore.ts の source of truth (DRAFT_RESOURCE_TYPES) から導出する。
// 旧来 inline 列挙していた enum 配列が drift しやすく、実際 editSession__list 側に
// `page-layout` / `er-layout` / `generic-definition` が漏れて MCP enum と allowlist の
// 範囲が不一致になっていた。本配列 1 箇所の更新で型 / Set / MCP enum が同期する。
import { DRAFT_RESOURCE_TYPES } from "./editSessionStore.js";

export const tools = [
  // ── フロー図操作ツール ──

  {
    name: "designer__list_screens",
    description:
      "プロジェクトに登録されている画面 (Screen) の一覧を取得します。purpose で page (画面遷移図対象) / gadget (PageLayout 部品) を絞り込めます (RFC #1021)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        // RFC #1021 pl-6 (Codex D-6): purpose filter 追加
        purpose: {
          type: "string",
          enum: ["page", "gadget"],
          description: "省略時は全件返却。'page' = 通常画面のみ、'gadget' = PageLayout 部品のみ",
        },
      },
      required: [],
    },
  },
  {
    name: "designer__add_screen",
    description:
      "フロー図に新しい画面ノードを追加します。追加後、ブラウザのフロー図に即時反映されます。" +
      " 新しい画面は、画面名の見出しだけを置いた業務部品レイアウト (layout) を持ちます。" +
      " 画面の中身は designer__set_screen_layout で設定してください。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "画面名（例: 顧客一覧）",
        },
        type: {
          type: "string",
          enum: ["login","dashboard","list","detail","form","search","confirm","complete","error","modal","wizard","other"],
          description: "画面種別。省略時は other",
        },
        path: {
          type: "string",
          description: "想定URL（例: /customers）。省略可。",
        },
        position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          description: "フロー図上の配置座標。省略時は自動配置。",
        },
        purpose: {
          type: "string",
          enum: ["page", "gadget"],
          description: "Screen 用途種別 (RFC #1021)。'page'（デフォルト）= 通常画面、'gadget' = PageLayout の region に割り当てる自律部品。",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "designer__update_screen",
    description:
      "既存画面のメタ情報 (名前・種別・説明・想定URL・purpose・pageLayoutId) を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "更新対象の画面ID（list_screens で取得）",
        },
        name: { type: "string", description: "新しい画面名" },
        type: {
          type: "string",
          enum: ["login","dashboard","list","detail","form","search","confirm","complete","error","modal","wizard","other"],
          description: "新しい画面種別",
        },
        description: { type: "string", description: "新しい説明" },
        path: { type: "string", description: "新しい想定URL (purpose=gadget の場合は省略可)" },
        purpose: {
          type: "string",
          enum: ["page", "gadget"],
          description: "Screen 用途種別 (RFC #1021)。'page'=通常画面 / 'gadget'=PageLayout の region に配置する自律部品",
        },
        pageLayoutId: {
          type: "string",
          description: "本 Screen が使用する PageLayout の ID (purpose=page のみ意味、空文字または null で解除)",
        },
      },
      required: ["screenId"],
    },
  },
  {
    name: "designer__remove_screen",
    description:
      "画面をフロー図から削除します。関連する遷移エッジとデザインデータも削除されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "削除する画面ID",
        },
      },
      required: ["screenId"],
    },
  },
  {
    name: "designer__add_edge",
    description:
      "2つの画面間に遷移エッジを追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: {
          type: "string",
          description: "遷移元の画面ID",
        },
        target: {
          type: "string",
          description: "遷移先の画面ID",
        },
        label: {
          type: "string",
          description: "遷移ラベル（例: 詳細ボタン）。省略可。",
        },
        trigger: {
          type: "string",
          enum: ["click","submit","select","cancel","auto","back","other"],
          description: "遷移トリガー。省略時は click",
        },
      },
      required: ["source", "target"],
    },
  },
  {
    name: "designer__remove_edge",
    description:
      "遷移エッジを削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        edgeId: {
          type: "string",
          description: "削除するエッジID（get_flow で取得）",
        },
      },
      required: ["edgeId"],
    },
  },
  {
    name: "designer__get_flow",
    description:
      "フロー図全体のデータ（全画面・全遷移エッジ）をJSON形式で取得します。プロジェクトの全体像を把握する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__navigate_screen",
    description:
      "ブラウザを指定画面のデザイナーへ遷移させます。画面のデザインを編集する前に呼びます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "遷移先の画面ID",
        },
      },
      required: ["screenId"],
    },
  },

  // ── 画面レイアウト (業務部品の木) とプロジェクト独自部品 ──

  {
    name: "designer__get_screen_layout",
    description:
      "画面の業務部品の木 (layout)・画面項目 (items)・検証結果 (issues) を取得します。" +
      "layout は section / form / search-panel / table / field / button 等の部品の入れ子で、field / table / button は itemRef で items を参照します。" +
      "type=component の部品はプロジェクト独自部品の参照 (componentRef + args) です。仕様: docs/spec/screen-layout.md",
    inputSchema: {
      type: "object" as const,
      properties: { screenId: { type: "string", description: "画面 ID (kebab-case)" } },
      required: ["screenId"],
    },
  },
  {
    name: "designer__set_screen_layout",
    description:
      "画面の layout (業務部品の木) を保存します。items を渡すと画面項目も置き換え、省略すると既存の items を保持します。" +
      "検証結果 (重複 ID・存在しない項目・置けない位置・未設定の差し込み口など) は保存を妨げず、counts と issues で返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "画面 ID (kebab-case)" },
        layout: { type: "object", description: "{ version: 1, nodes: LayoutNode[] }" },
        items: { type: "array", description: "画面項目 (省略時は既存を保持)", items: { type: "object" } },
      },
      required: ["screenId", "layout"],
    },
  },
  {
    name: "designer__list_layout_components",
    description:
      "プロジェクト独自部品 (layout-components.json) の定義一覧を、使用箇所 (画面・他の独自部品) と定義の検証結果つきで取得します。" +
      "独自部品は部品の木の断片に名前と差し込み口 (params: text / item / screen) を付けたもので、テンプレート内の {{paramId}} が画面側の args で置き換わります。" +
      "仕様: docs/spec/layout-components.md",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__save_layout_component",
    description:
      "プロジェクト独自部品を 1 件追加または置換します (id で照合、他の部品には触れません)。" +
      "定義にエラー (ID 不正・未定義の差し込み口の使用・循環など) があると保存しません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: { type: "object", description: "{ id (kebab-case), label, description?, category?, params: [{id,label,kind,default?}], nodes: LayoutNode[] }" },
      },
      required: ["component"],
    },
  },
  {
    name: "designer__delete_layout_component",
    description: "プロジェクト独自部品を削除します。画面や他の独自部品から使われている場合は force: true を指定しない限り削除せず、使用箇所を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        componentId: { type: "string", description: "独自部品の ID" },
        force: { type: "boolean", description: "使用中でも削除する (使っている部品は「定義が見つかりません」になる)" },
      },
      required: ["componentId"],
    },
  },

  // ── 業務フロー (スイムレーン) ──

  {
    name: "designer__list_designs",
    description: "シーケンス図 (sequence)・DB ビュー (view)・ビュー定義 (viewDefinition)・汎用定義 (genericDefinition。メッセージ・ドメイン型・状態遷移・初期データなど 21 種) の一覧。kind で種類を選ぶ。genericDefinition は definitionKind で絞れる (省略すると全種)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["sequence", "view", "viewDefinition", "genericDefinition"], description: "設計の種類" },
        definitionKind: { type: "string", description: "genericDefinition のときの種類 (message / domain-type / constants / options など)" },
        limit: { type: "number", description: "件数の上限 (既定 200、最大 1000)" },
        offset: { type: "number", description: "読み飛ばす件数 (既定 0)" },
      },
      required: ["kind"],
    },
  },
  {
    name: "designer__get_design",
    description: "シーケンス図・DB ビュー・ビュー定義・汎用定義の 1 件の原本を読む。sequence / view / viewDefinition は id、genericDefinition は definitionKind + name。",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["sequence", "view", "viewDefinition", "genericDefinition"] },
        id: { type: "string", description: "sequence / view / viewDefinition の id" },
        definitionKind: { type: "string", description: "genericDefinition の種類" },
        name: { type: "string", description: "genericDefinition の名前" },
      },
      required: ["kind"],
    },
  },
  {
    name: "designer__save_design",
    description: "シーケンス図・DB ビュー・ビュー定義・汎用定義を保存する (なければ作り、あれば置き換える)。途中でも保存できる。保存後は designer__check_design で確かめる。形は schemas/v3 (harmony://schema/sequence など) と docs/spec/generic-definition-layer.md。",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["sequence", "view", "viewDefinition", "genericDefinition"] },
        id: { type: "string", description: "sequence / view / viewDefinition の id" },
        definitionKind: { type: "string", description: "genericDefinition の種類" },
        name: { type: "string", description: "genericDefinition の名前 (省略時は design.name)" },
        design: { type: "object", description: "設計の本体 (JSON)" },
      },
      required: ["kind", "design"],
    },
  },
  {
    name: "designer__delete_design",
    description: "シーケンス図・DB ビュー・ビュー定義・汎用定義を削除する。削除の前に designer__find_references で参照元を確かめる。",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["sequence", "view", "viewDefinition", "genericDefinition"] },
        id: { type: "string" },
        definitionKind: { type: "string" },
        name: { type: "string" },
      },
      required: ["kind"],
    },
  },
  {
    name: "designer__get_conventions",
    description: "規約 (conventions.json: ロール・権限・上限値・正規表現・DB 規約・メッセージなど) を読む。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__save_conventions",
    description: "規約 (conventions.json) を全体として置き換える。先に designer__get_conventions で読み、直した全体を渡す。形は harmony://schema/conventions。",
    inputSchema: { type: "object" as const, properties: { conventions: { type: "object", description: "規約の全体 (JSON)" } }, required: ["conventions"] },
  },
  {
    name: "designer__import_ddl",
    description: "DDL (CREATE TABLE。pg_dump -s / mysqldump --no-data の出力でもよい) から、テーブル定義を作る。既定は予行 (何が作られるか・読み飛ばしたもの・注意を返す)。apply: true で保存。同じ id のテーブルは overwrite: true のときだけ置き換える。",
    inputSchema: {
      type: "object" as const,
      properties: { sql: { type: "string", description: "512 KiB まで" }, apply: { type: "boolean", description: "true で保存 (既定は予行)" }, overwrite: { type: "boolean", description: "同じ id のテーブルを丸ごと置き換える" }, ids: { type: "array", items: { type: "string" }, description: "取り込むテーブルの id (省略時は全部。500 件を超えるときに絞る)" } },
      required: ["sql"],
    },
  },
  {
    name: "designer__import_openapi",
    description: "OpenAPI (3.x / swagger 2) の文書から、処理フローの雛形 (操作ごとに 1 本。HTTP の経路・入力・出力・応答だけ。工程は空) を作る。既定は予行。apply: true で保存。同じ id は overwrite: true のときだけ置き換える。",
    inputSchema: {
      type: "object" as const,
      properties: { spec: { type: "object", description: "OpenAPI 文書 (JSON)" }, apply: { type: "boolean" }, overwrite: { type: "boolean", description: "同じ id の処理フローを丸ごと置き換える" }, ids: { type: "array", items: { type: "string" }, description: "取り込む処理フローの id (省略時は全部)" } },
      required: ["spec"],
    },
  },
  {
    name: "designer__get_tech_stack",
    description: "技術スタック (harmony.json の techStack: 画面デザイナ・backend・データベースなど。コード生成の指針) を読む。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__save_tech_stack",
    description: "技術スタック (harmony.json の techStack) を全体として置き換える。先に designer__get_tech_stack で読み、直した全体を渡す。",
    inputSchema: { type: "object" as const, properties: { techStack: { type: "object", description: "技術スタックの全体 (JSON)" } }, required: ["techStack"] },
  },
  {
    name: "designer__search_design",
    description: "設計全体の本文検索 (説明・項目・SQL・条件・メッセージなど。画面の検索と同じ)。名前・id で探すのは list_* 。query は 2 文字以上、空白で AND。",
    inputSchema: {
      type: "object" as const,
      properties: { query: { type: "string" }, limit: { type: "number", description: "件数の上限 (既定 30、最大 100)" } },
      required: ["query"],
    },
  },
  {
    name: "designer__list_steps",
    description: "処理フローの工程の一覧 (番号・id・種類・要点・対象・備考)。丸ごと読まずに構造をつかむ。actionId で 1 アクションに絞る。中身は designer__get_step。",
    inputSchema: {
      type: "object" as const,
      properties: { processFlowId: { type: "string" }, actionId: { type: "string" }, limit: { type: "number", description: "アクションごとの行数の上限 (既定 300、最大 1000)" }, offset: { type: "number" } },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__get_step",
    description: "処理フローの 1 工程の原本 (入れ子の中も)。親の経路 (どの分岐の道・繰り返しの中か) と、実行条件 (runIf) の言葉つき。stepId は designer__list_steps で。",
    inputSchema: {
      type: "object" as const,
      properties: { processFlowId: { type: "string" }, stepId: { type: "string" }, actionId: { type: "string" } },
      required: ["processFlowId", "stepId"],
    },
  },
  {
    name: "designer__get_flow_story",
    description: "処理フローを「流れ」の文章 (Markdown) で返す。条件は言葉 (『顧客がいない のとき』)、工程は番号つきの入れ子。画面の「流れ」表示・設計書と同じ読み方。人に説明する・全体を短くつかむときに使う。",
    inputSchema: {
      type: "object" as const,
      properties: { processFlowId: { type: "string" }, actionId: { type: "string" } },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__analyze_branches",
    description: "処理フローの分岐の判定表 (条件 × 道の ○ × －) と指摘 (隠れる道・同時に成り立つ道・どの道にも入らない組み合わせ)。分岐は上から順に、最初に成り立った道だけを実行する。stepId で 1 つの分岐に絞る。",
    inputSchema: {
      type: "object" as const,
      properties: { processFlowId: { type: "string" }, actionId: { type: "string" }, stepId: { type: "string", description: "分岐の工程の id" } },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__validate_design",
    description: "保存せずに、JSON がスキーマ・検証に合うかを確かめる (processFlow / screen / table はスキーマ、report / businessFlow は検証)。作ってから保存する前の確認に使う。",
    inputSchema: {
      type: "object" as const,
      properties: { kind: { type: "string", enum: ["processFlow", "screen", "table", "report", "businessFlow"] }, design: { type: "object", description: "確かめたい設計 (JSON)" } },
      required: ["kind", "design"],
    },
  },
  {
    name: "designer__get_changes_since",
    description: "ある時刻より後に変わった設計ファイルの一覧 (種類・id・更新時刻)。人が画面で直した分を知るときに使う。since は ISO の日時 (省略すると直近 24 時間)。",
    inputSchema: { type: "object" as const, properties: { since: { type: "string", description: "例: 2026-10-24T09:00:00+09:00" } }, required: [] },
  },
  {
    name: "designer__edit_steps",
    description: "処理フローの工程を、複数まとめて編集する (追加・更新・削除・移動・入れ子の移動)。edits を先頭から順に適用し、全部成功するか、何も保存しないかのどちらか。既定は予行 (apply: true で保存)。保存済みのファイルだけが対象 (画面で開いている処理フローは断る。その場合は add_step / update_step など)。1 回 100 件まで。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        edits: {
          type: "array",
          description: "編集の並び。op = add { actionId, kind, description?, detail?, id?, position?, parentStepId? } / update { stepId, patch } / remove { stepId } / move { stepId, newIndex } / nest { stepId, direction: indent|outdent }。add の id を指定すると、後ろの編集がその工程を指せる",
          items: { type: "object", properties: { op: { type: "string", enum: ["add", "update", "remove", "move", "nest"] } }, required: ["op"] },
        },
        apply: { type: "boolean", description: "true で保存 (既定は予行)" },
      },
      required: ["processFlowId", "edits"],
    },
  },
  {
    name: "designer__get_tool_guide",
    description: "tool 1 つの詳細 (完全な説明・引数・注釈・入っているプロファイル) を返す。name を省略すると tool の名前の一覧。接続の URL に ?detail=brief を付けると、tools/list の説明が短くなるので、詳しく知りたい tool だけここで引く。",
    inputSchema: { type: "object" as const, properties: { name: { type: "string", description: "tool の名前 (designer__ は省略できる)" } }, required: [] },
  },
  {
    name: "designer__walk_flow",
    description: "処理フローを、開始から順に机上で辿る (条件は評価しない)。分岐・繰り返しで、人 (AI) が選ぶ道を choices に並べて渡すと、通る工程と、そこまでに定義された変数を返す。choices が足りなければ、そこで止まり、選べる道 (awaiting.choices) を返す。選び方は、番号 (1 始まり)・選択肢の id (b0 / else / enter / skip / again / exit)・ラベルの先頭 (A)。処理が意図どおりに進むかを、書いた直後に確かめる。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        actionId: { type: "string", description: "アクションが複数あるときは必須" },
        choices: { type: "array", items: { type: ["string", "number"] }, description: "分岐・繰り返しで選ぶ道を、通る順に (500 件まで)" },
      },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__report_confusion",
    description: "資料・スキーマ・tool の説明で詰まった点を残す (次の改善に使う)。作業を止めずに、短く書く。例: topic「edit_steps の add の detail の書き方が分からない」tool「edit_steps」。ワークスペースの .harmony-ops/ai-feedback.json に残り、git には載らない。利用者は npm run ai:feedback で集計する。秘密 (トークン・パスワード・顧客の個人情報) は書かない。",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "何で詰まったか (200 文字まで)" },
        detail: { type: "string", description: "どう詰まったか・試したこと (2000 文字まで)" },
        tool: { type: "string", description: "関係する tool の名前" },
        doc: { type: "string", description: "関係する資料 (harmony://… か、ファイルのパス)" },
        expected: { type: "string", description: "本当はどうなっていてほしかったか" },
      },
      required: ["topic"],
    },
  },
  {
    name: "designer__get_design_document",
    description: "設計書 (画面の「設計書」と同じ内容) の目次と、章ごとの本文。chapter を省略すると目次と要確認の件数、chapter に目次の id を渡すと、その章を読みやすい文章 (format: text) か HTML で返す。設計全体をまとめて読むより、必要な章だけ読む。",
    inputSchema: {
      type: "object" as const,
      properties: { chapter: { type: "string", description: "目次の id (例: screens / screen-cart)" }, format: { type: "string", enum: ["text", "html"], description: "既定は text" } },
      required: [],
    },
  },
  {
    name: "designer__get_generation_brief",
    description: "コードを生成する前に集める情報を、1 つの文書 (Markdown) にまとめる。処理フロー (processFlowId) なら: 何を作るか・技術スタック・処理の流れ (言葉)・使うテーブル (カラム)・規約の参照 (@conv.*)・呼び出す画面の項目・テスト観点・記録の呼び方。画面 (screenId) なら: 項目の制約・呼ぶ処理フロー・遷移・テスト観点。生成の手順は Prompt generate-code。",
    inputSchema: {
      type: "object" as const,
      properties: { processFlowId: { type: "string" }, screenId: { type: "string" } },
      required: [],
    },
  },
  {
    name: "designer__check_test_coverage",
    description: "生成したテストが、テスト観点表 (designer__get_test_viewpoints) の何 % を覆うかを数える。record_generation で記録された生成物のうち、パスに test / spec を含むものの本文に、観点の ID が書かれているかで見る。観点ごとの覆い方・覆っていない観点を返す。screenIds / flowIds で対象を絞れる (一方だけ指定したら、もう一方は対象にしない)。",
    inputSchema: {
      type: "object" as const,
      properties: { screenIds: { type: "array", items: { type: "string" } }, flowIds: { type: "array", items: { type: "string" } } },
      required: [],
    },
  },
  {
    name: "designer__compare_workspaces",
    description: "いまのワークスペースと、登録済みの別のワークスペース (id またはパス。designer__workspace_list) を、種類ごとに id で比べる (片方だけにあるもの・両方にあるものの数)。",
    inputSchema: { type: "object" as const, properties: { other: { type: "string", description: "比べる相手のワークスペースの id またはパス" } }, required: ["other"] },
  },
  {
    name: "designer__get_project_context",
    description:
      "いま開いているワークスペースの設計全体の要約を返します。接続して最初に 1 回呼ぶと、種類ごとの一覧 tool を何度も呼ばずに全体をつかめます: プロジェクト名・技術スタック・各設計 (画面 / 処理フロー / テーブル / 業務フロー / 帳票) の id と名前と件数・規約の数・未解決のマーカー (人から AI への指示・質問)・次に使う tool と資料。" +
      "中身 (工程・カラム) は載せません。読むには get_process_flow / get_table などを使ってください。資料は Resources (harmony://docs/ai-index) にあります。",
    inputSchema: {
      type: "object" as const,
      properties: { limit: { type: "number", description: "種類ごとに載せる設計の数の上限 (既定 60、最大 500)。超えた分は total で件数だけ分かる" } },
      required: [],
    },
  },
  {
    name: "designer__check_design",
    description:
      "設計全体の「要確認事項」(画面の部品・項目、処理フロー、業務フロー、帳票、権限、CRUD などの抜け・矛盾) を検査して返します。設計書ビュー・`npm run check:design` と同じ検査です。" +
      "設計を直したあと、完了を報告する前に呼び、error / warning が 0 件 (ok: true) になるまで直してください。仕様: docs/spec/design-document.md",
    inputSchema: {
      type: "object" as const,
      properties: { includeInfo: { type: "boolean", description: "情報 (info) の項目も含める (既定は含めない)" } },
      required: [],
    },
  },
  {
    name: "designer__record_generation",
    description:
      "コードを生成したあとに、「どの設計から、どのファイルを作ったか」を記録します。以後、設計が変わると「再生成が必要」、生成物が書き換えられると「生成物が変わった」と検出できます (designer__check_generation_drift)。" +
      "path は、base (既定はワークスペース。/generate-code の既定の出力先 .tmp/generated-code/ なら generated-code) からの相対パス (その中のファイルだけ)。sources は、元にした設計 (kind: screen / table / processFlow / businessFlow / report / sequence / view / viewDefinition と id)。" +
      "コードを生成・再生成したら、必ずこの tool で記録してください。仕様: docs/spec/integration-ops.md",
    inputSchema: {
      type: "object" as const,
      properties: {
        outputs: {
          type: "array",
          description: "生成したファイルの一覧 (500 まで)",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "base からの相対パス (例: orders/order.service.ts)" },
              base: { type: "string", enum: ["workspace", "generated-code"], description: "path の基準。workspace = ワークスペース (既定)、generated-code = 本体の .tmp/generated-code/ (/generate-code の既定の出力先)" },
              sources: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, id: { type: "string" } }, required: ["kind", "id"] }, description: "元にした設計" },
              generator: { type: "string", description: "生成の道具・skill (例: generate-code)" },
              note: { type: "string" },
            },
            required: ["path", "sources"],
          },
        },
      },
      required: ["outputs"],
    },
  },
  {
    name: "designer__check_generation_drift",
    description:
      "記録した生成物 (designer__record_generation) と、いまの設計・ファイルを突き合わせます。state: current (最新) / design-changed (設計が変わった: 再生成が必要) / output-changed (生成物が書き換えられた) / both-changed (両方が変わった: どちらを正とするか確認) / output-missing (生成物がない)。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_regeneration_diff",
    description:
      "記録した生成のときの設計と、いまの設計の差 (変更・追加・削除された項目の場所と前後の値) を返します。設計が変わったファイルだけ、変わった箇所に絞って再生成するときに使います。",
    inputSchema: { type: "object" as const, properties: { path: { type: "string", description: "生成物のパス。省略すると、設計が変わったすべての生成物" } }, required: [] },
  },
  {
    name: "designer__add_review_findings",
    description:
      "設計のレビューで見つけた指摘を、設計の箇所に紐づくレビューコメントとして残します (人はレビューコメントの画面・各設計で見て、解決済みにします)。" +
      "kind / id は設計の種類と id、path は設計の中の箇所 (例: `columns[2]` `actions[0].steps`)。severity: error / warning / info。同じ内容の未解決の指摘が既にあれば、重ねません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        findings: {
          type: "array",
          description: "指摘の一覧 (50 まで)",
          items: {
            type: "object",
            properties: { kind: { type: "string" }, id: { type: "string" }, path: { type: "string" }, message: { type: "string" }, severity: { type: "string", enum: ["error", "warning", "info"] } },
            required: ["kind", "id", "message"],
          },
        },
      },
      required: ["findings"],
    },
  },
  {
    name: "designer__list_review_comments",
    description: "レビューコメントのスレッドの一覧を返します (未解決のものが既定)。AI が指摘に対応するとき、対象の設計と箇所・内容を確認するのに使います。",
    inputSchema: {
      type: "object" as const,
      properties: { status: { type: "string", enum: ["open", "resolved", "all"], description: "既定は open" }, kind: { type: "string" }, id: { type: "string" } },
      required: [],
    },
  },
  {
    name: "designer__list_versions",
    description:
      "設計 1 件の「上書きされる前の版」の一覧 (新しい順、最大 20 件) を返します。保存・AI の書き込みのたびに、上書き直前の内容が自動で残ります。" +
      "誤って消した・壊した設計を戻す前の確認に使います。対応: table / process-flow / view / view-definition / sequence / business-flow / report / page-layout。仕様: docs/spec/file-backup.md",
    inputSchema: {
      type: "object" as const,
      properties: {
        resourceType: { type: "string", enum: ["table", "process-flow", "view", "view-definition", "sequence", "business-flow", "report", "page-layout"], description: "設計の種類" },
        id: { type: "string", description: "設計の ID" },
      },
      required: ["resourceType", "id"],
    },
  },
  {
    name: "designer__restore_version",
    description:
      "designer__list_versions の版を、設計に書き戻します。現在の内容も版として残るので、取り消せます (もう一度この tool で戻す)。" +
      "ほかの人・AI が編集中の設計には書き戻せません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        resourceType: { type: "string", enum: ["table", "process-flow", "view", "view-definition", "sequence", "business-flow", "report", "page-layout"], description: "設計の種類" },
        id: { type: "string", description: "設計の ID" },
        versionId: { type: "string", description: "designer__list_versions の versions[].id" },
      },
      required: ["resourceType", "id", "versionId"],
    },
  },
  {
    name: "designer__repair_registry",
    description:
      "プロジェクトの一覧 (harmony.json) とファイルの食い違いを直します: ファイルはあるが一覧に載っていない設計を一覧に足し、一覧にあるがファイルが無い項目を外し、harmony.json の最上位にある旧形式の項目 (tables / updatedAt など。v3 のスキーマに無く、画面がワークスペースを開けなくなる) を取り除きます。一覧にあるテーブルの要約 (名前・物理名・カテゴリ・カラム数) が、テーブルのファイルと食い違っていれば、ファイルに合わせて直します。" +
      "既定は予行 (書かずに、足す・外す・直す設計だけを返す)。実行するには apply: true を付けます。",
    inputSchema: {
      type: "object" as const,
      properties: { apply: { type: "boolean", description: "true で実際に書く (既定は予行)" } },
      required: [],
    },
  },
  {
    name: "designer__persist_uuids",
    description:
      "uuid がファイルに保存されていない設計に、読み出しで補っている値 (種類と id から決めた値) を書いて固定します。" +
      "既定は予行 (書かずに、対象のファイルだけを返す)。実行するには apply: true を付けます。",
    inputSchema: {
      type: "object" as const,
      properties: { apply: { type: "boolean", description: "true で実際に書く (既定は予行)" } },
      required: [],
    },
  },
  {
    name: "designer__migrate_schema",
    description:
      "設計データを、最新のスキーマの版へ移行します (スキーマの版が上がったあとに使う)。既定は予行 (書かずに、書き換わるファイルと変わる項目を返す)。実行するには apply: true を付けます。" +
      "書き換える前の内容は世代として残ります。編集中のセッションがあるときは実行できません。移行が不要なら、その旨を返します。",
    inputSchema: {
      type: "object" as const,
      properties: { apply: { type: "boolean", description: "true で実際に書く (既定は予行)" } },
      required: [],
    },
  },
  {
    name: "designer__find_references",
    description:
      "ある設計 (画面・テーブル・処理フロー・シーケンス・ビュー・ビュー定義・ページレイアウト) を参照している設計の一覧 (参照元) を返します。" +
      "ID の改名・削除の前の影響確認や、「これは誰が使っているか」を辿るときに使います。業務フロー・帳票・画面フロー (遷移) からの参照も含みます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["screen", "table", "processFlow", "sequence", "view", "viewDefinition", "pageLayout"], description: "調べる設計の種類" },
        id: { type: "string", description: "調べる設計の ID (kebab-case)" },
      },
      required: ["entityType", "id"],
    },
  },
  {
    name: "designer__rename_entity",
    description:
      "設計の ID を改名します (画面・テーブル・処理フロー・シーケンス・ビュー・ビュー定義・ページレイアウト)。ファイル名と、業務フロー・帳票・画面フロー・他の設計からの参照を、まとめて書き換えます。" +
      "既定は予行 (apply を付けない) で、影響するファイル・参照元と、止める理由 (ID の重複・編集中のセッション等) を返します。内容を確かめてから apply: true で実行してください。実行結果の operation.operationId で、一定時間は designer__undo_rename で戻せます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["screen", "table", "processFlow", "sequence", "view", "viewDefinition", "pageLayout"], description: "改名する設計の種類" },
        oldId: { type: "string", description: "いまの ID" },
        newId: { type: "string", description: "新しい ID (kebab-case)" },
        apply: { type: "boolean", description: "true で実行。省略時は予行だけ" },
      },
      required: ["entityType", "oldId", "newId"],
    },
  },
  {
    name: "designer__undo_rename",
    description: "designer__rename_entity で実行した改名を元に戻します (実行結果の operation.operationId を指定。時間が経つと戻せません)。",
    inputSchema: {
      type: "object" as const,
      properties: { operationId: { type: "string", description: "designer__rename_entity の実行結果にある operation.operationId" } },
      required: ["operationId"],
    },
  },
  {
    name: "designer__replace_references",
    description:
      "ある設計 (A) を参照している設計のうち、選んだものの参照を、別の設計 (B) へ付け替えます (改名とは別: A は残ります)。" +
      "参照元の設計ごとに、その中の A への参照がすべて B になります (業務フロー・帳票は対象外で、予行の warnings に出ます)。" +
      "既定は予行 (apply を付けない) で、付け替わる参照元と数を返します。referrers で参照元を選び (省略時は予行ではすべて)、apply: true で実行します。" +
      "実行結果の operationId で、5 分以内なら designer__undo_replace_references で戻せます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["screen", "table", "processFlow", "sequence", "view", "viewDefinition", "pageLayout"], description: "付け替える設計の種類 (A と B は同じ種類)" },
        fromId: { type: "string", description: "いま参照している設計 (A) の ID" },
        toId: { type: "string", description: "付け替え先の設計 (B) の ID" },
        referrers: { type: "array", items: { type: "string" }, description: "付け替える参照元。予行の files[].filePath (例: process-flows/order-create.json)。apply: true のときは必須" },
        apply: { type: "boolean", description: "true で実行。省略時は予行だけ" },
      },
      required: ["entityType", "fromId", "toId"],
    },
  },
  {
    name: "designer__undo_replace_references",
    description: "designer__replace_references で実行した付け替えを元に戻します (実行結果の operationId を指定。5 分を過ぎた・付け替えのあとに編集された設計は戻せません)。",
    inputSchema: {
      type: "object" as const,
      properties: { operationId: { type: "string", description: "designer__replace_references の実行結果にある operationId" } },
      required: ["operationId"],
    },
  },
  {
    name: "designer__get_test_viewpoints",
    description:
      "テスト観点表を返します。画面入力 (必須・桁数・範囲・形式の正常 / 異常 / 境界値) と処理 (分岐と終了) を、決まった ID つきで導出します。" +
      "テストコード (Playwright 等) を書くときの入力にします。同じ設計からは同じ ID が出ます。仕様: docs/spec/test-viewpoints.md",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenIds: { type: "array", items: { type: "string" }, description: "この画面だけに絞る (省略時は全画面)" },
        flowIds: { type: "array", items: { type: "string" }, description: "この処理フローだけに絞る (省略時は全処理)" },
        since: { type: "string", description: "ISO の日時。この時刻より後に変わった画面・処理フローだけに絞る (変更の影響を受ける観点だけを作り直す。screenIds / flowIds と一緒なら積。規約の変更で変わる観点は拾わない)" },
        format: { type: "string", enum: ["json", "csv"], description: "既定は json (入力値つき)" },
        scaffold: { type: "string", enum: ["vitest", "jest", "playwright"], description: "指定すると、観点からテストの雛形 (題名・入力・期待結果を持つ未実装のテスト) のファイル一覧を返す" },
      },
      required: [],
    },
  },
  {
    name: "designer__analyze_design",
    description:
      "設計の分析を返します (読み取りのみ)。kind: impact (影響分析: 変えると連鎖して影響する設計。entityType と id が要る。テーブルは column で列に絞れる) / traceability (業務フロー→画面→処理→テーブル→テスト観点の対応表と欠け) / " +
      "unused (未使用のテーブル・メッセージ・画面・処理ほか) / terms (用語の揺れ) / column-map (画面項目とカラムの対応) / messages (メッセージの使用箇所・重複) / sql (処理フローの SQL の一覧と、同じ SQL の重複) / operations (役割×画面×操作の権限) / " +
      "sla (性能の目標の宣言) / jobs (バッチ・定期処理と依存) / external (外部システムの呼び出しと相手の OpenAPI の突き合わせ) / progress (成熟度の集計と推移) / suppressions (抑制中・期限切れの要確認)。仕様: docs/spec/design-analysis.md",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["impact", "traceability", "unused", "terms", "column-map", "messages", "sql", "operations", "sla", "jobs", "external", "progress", "suppressions"] },
        entityType: { type: "string", enum: ["screen", "processFlow", "table", "businessFlow", "report", "component", "message", "regex", "limit", "genericDefinition"], description: "impact の対象の種類" },
        id: { type: "string", description: "impact の対象の ID" },
        column: { type: "string", description: "impact (table) で絞る列 (Column.id か物理名)" },
        format: { type: "string", enum: ["json", "csv"], description: "traceability / column-map / sql / operations / sla は csv にできる (既定は json)" },
      },
      required: ["kind"],
    },
  },
  {
    name: "designer__export_openapi",
    description: "処理フローのアクションが持つ HTTP の契約 (メソッド・パス・入力・応答・認証) から、OpenAPI 3.0.3 の文書 (JSON) を作って返します。書き込みはしません。",
    inputSchema: { type: "object" as const, properties: { title: { type: "string" }, version: { type: "string" } }, required: [] },
  },
  {
    name: "designer__generate_test_data",
    description:
      "テーブルの定義 (型・長さ・NOT NULL・主キー・一意・外部キー・単純な CHECK) に沿ったテストデータを生成して返します。同じ seed・件数なら同じデータ。書き込みはしません。外部キーの親は先に作ります。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableIds: { type: "array", items: { type: "string" }, description: "対象のテーブル (省略時は全テーブル)" },
        rowsPerTable: { type: "number", description: "1 テーブルの行数 (既定 10、上限 1000)" },
        seed: { type: "number" },
        nulls: { type: "boolean", description: "NULL を許す列に、ときどき NULL を入れる" },
        format: { type: "string", enum: ["json", "sql", "csv"], description: "既定は json。csv は tableIds で 1 つに絞ったときだけ" },
        dialect: { type: "string", enum: ["standard", "mysql", "sqlserver"], description: "sql の識別子の引用の形式" },
      },
      required: [],
    },
  },
  {
    name: "designer__list_business_flows",
    description: "業務フロー (business-flows/) の一覧を取得します。各業務フローの ID・名前・レーン数・工程数・要確認の件数を返します。仕様: docs/spec/business-flow.md",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_business_flow",
    description: "業務フロー 1 件の原本 (レーン・工程・つながり) と検証結果を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: { flowId: { type: "string", description: "業務フロー ID (kebab-case)" } },
      required: ["flowId"],
    },
  },
  {
    name: "designer__save_business_flow",
    description:
      "業務フロー 1 件を保存します (新規作成または置換)。誰が (lanes) 何をするか (steps) とそのつながり (steps[].next) を表します。" +
      "図の座標は持ちません (自動配置)。構造 (lanes / steps が配列) 以外の問題は保存を妨げず、検証結果として返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        flowId: { type: "string", description: "業務フロー ID (kebab-case)。ファイル名になる" },
        flow: {
          type: "object",
          description: "{ name, description?, maturity?, lanes: [{id,name,kind?(person|system|external),roleRef?}], steps: [{id,lane,kind(start|task|decision|end),name,description?,screenRef?,processFlowRef?,next?:[{to,label?}]}] }",
        },
      },
      required: ["flowId", "flow"],
    },
  },
  {
    name: "designer__delete_business_flow",
    description: "業務フローを 1 件削除します。",
    inputSchema: {
      type: "object" as const,
      properties: { flowId: { type: "string", description: "業務フロー ID" } },
      required: ["flowId"],
    },
  },

  // ── 帳票 ──

  {
    name: "designer__list_reports",
    description: "帳票 (reports/) の一覧を取得します。各帳票の ID・名前・出力形式・部数・項目数・要確認の件数を返します。仕様: docs/spec/report.md",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_report",
    description: "帳票 1 件の原本 (出力・契機・出力条件・部と項目) と検証結果を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: { reportId: { type: "string", description: "帳票 ID (kebab-case)" } },
      required: ["reportId"],
    },
  },
  {
    name: "designer__save_report",
    description:
      "帳票 1 件を保存します (新規作成または置換)。紙に出力する帳票の、出力形式・用紙・出力契機・出力条件と、部 (表題・明細・合計など) ごとの項目を表します。" +
      "座標は持ちません (用紙の見本図は自動で描きます)。構造 (sections が配列) 以外の問題は保存を妨げず、検証結果として返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        reportId: { type: "string", description: "帳票 ID (kebab-case)。ファイル名になる" },
        report: {
          type: "object",
          description: "{ name, description?, maturity?, output?:{format(pdf|excel|csv|html),paper(A4|A3|B4|B5|letter),orientation(portrait|landscape)}, trigger?:{kind(screen|batch|api),screenRef?,processFlowRef?,description?}, params?:[{id,label,type?,required?}], sort?:[{field,order?}], sections:[{id,kind(reportHeader|pageHeader|groupHeader|detail|groupFooter|reportFooter|pageFooter),name?,groupBy?,fields:[{id,kind(text|field|aggregate|pageNumber|date),label?,source?(<テーブルID>.<列> | @param.<id>),aggregate?(sum|count|avg|min|max),format?,align?,width?(%)}]}] }",
        },
      },
      required: ["reportId", "report"],
    },
  },
  {
    name: "designer__delete_report",
    description: "帳票を 1 件削除します。",
    inputSchema: {
      type: "object" as const,
      properties: { reportId: { type: "string", description: "帳票 ID" } },
      required: ["reportId"],
    },
  },

  // ── テーブル設計書ツール ──

  {
    name: "designer__list_tables",
    description:
      "プロジェクトに定義されたテーブル設計書の一覧を取得します。各テーブルのID・物理名・表示名 (論理名)・カテゴリ・カラム数を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__get_table",
    description:
      "指定テーブルの完全な定義（カラム・インデックス含む）を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "取得するテーブルのID（list_tables で取得）",
        },
      },
      required: ["tableId"],
    },
  },
  {
    name: "designer__add_table",
    description:
      "新しいテーブル定義を追加します (カラムは空。あとから designer__update_table で足す)。physicalName (物理名) と name (表示名。論理名はここに書く) が必須です。",
    inputSchema: {
      type: "object" as const,
      properties: {
        physicalName: {
          type: "string",
          description: "物理名 (DB のテーブル名)。英小文字で始まる snake_case、63 文字まで。例: customers",
        },
        name: {
          type: "string",
          description: "表示名 (論理名。例: 顧客マスタ)",
        },
        description: {
          type: "string",
          description: "テーブルの説明",
        },
        category: {
          type: "string",
          description: "カテゴリ（マスタ, トランザクション 等）。省略可。",
        },
      },
      required: ["physicalName", "name"],
    },
  },
  {
    name: "designer__update_table",
    description:
      "テーブル定義を更新します。カラムやインデックスを含む完全な定義を渡します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "更新対象のテーブルID",
        },
        definition: {
          type: "object",
          description: "テーブル定義の完全なJSON（TableDefinition型）",
        },
      },
      required: ["tableId", "definition"],
    },
  },
  {
    name: "designer__remove_table",
    description:
      "テーブル定義を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "削除するテーブルID",
        },
      },
      required: ["tableId"],
    },
  },
  {
    name: "designer__list_page_layouts",
    description: "プロジェクトに定義された PageLayout の一覧を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__add_page_layout",
    description: "新しい PageLayout を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "PageLayout の表示名（例: Main Layout）",
        },
        description: {
          type: "string",
          description: "用途説明（省略可）",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "designer__update_page_layout",
    description: "PageLayout を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: {
          type: "string",
          description: "更新対象の PageLayout ID",
        },
        definition: {
          type: "object",
          description: "PageLayout の完全な定義",
        },
      },
      required: ["pageLayoutId", "definition"],
    },
  },
  {
    name: "designer__remove_page_layout",
    description: "PageLayout を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: {
          type: "string",
          description: "削除する PageLayout ID",
        },
      },
      required: ["pageLayoutId"],
    },
  },
  {
    // RFC #1021 pl-6 (Codex D-2): get / save MCP tools 追加 (ISSUE #1023 受け入れ基準 6 種完備)
    name: "designer__get_page_layout",
    description: "PageLayout の完全な定義を ID で取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: { type: "string", description: "取得対象の PageLayout ID" },
      },
      required: ["pageLayoutId"],
    },
  },
  {
    name: "designer__save_page_layout",
    description: "PageLayout の完全な定義を保存します (update_page_layout より柔軟、AI 連携用)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: { type: "string", description: "保存対象の PageLayout ID" },
        data: { type: "object", description: "PageLayout の完全な JSON 定義" },
      },
      required: ["pageLayoutId", "data"],
    },
  },
  {
    name: "designer__generate_ddl",
    description:
      "指定テーブルのDDL（CREATE TABLE文）を生成します。テーブル名・カラム名・索引・外部キーは物理名（physicalName）で出します（name は表示名）。SQLダイアレクトを指定できます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "DDLを生成するテーブルID。省略で全テーブル。",
        },
        dialect: {
          type: "string",
          enum: ["mysql", "postgresql", "oracle", "sqlserver", "sqlite", "standard"],
          description: "SQLダイアレクト。省略時は standard",
        },
      },
      required: [],
    },
  },

  // ── ER図ツール ──

  {
    name: "designer__get_er_diagram",
    description:
      "ER図データ（全テーブル・リレーション・Mermaid記法）を取得します。テーブル設計書の外部キー定義からリレーションを自動検出します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__export_spec",
    description:
      "プロジェクトの統合仕様書をJSON形式で出力します。テーブル定義・リレーション（物理/論理/概念）・画面情報・画面遷移を含む、PG工程のAIエージェントが正確に解釈可能なフォーマットです。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__generate_er_mermaid",
    description:
      "Mermaid ER図記法を生成します。テーブル設計書の外部キー定義と論理リレーションから生成します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ── タブ管理・保存操作ツール ──

  {
    name: "designer__open_tab",
    description:
      "指定した画面またはテーブルをブラウザのタブで開きます。既に開いている場合はそのタブに切り替えます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "開く画面のID（designer__list_screens で取得）",
        },
        tableId: {
          type: "string",
          description: "開くテーブルのID（designer__list_tables で取得）",
        },
      },
      required: [],
    },
  },
  {
    name: "designer__close_tab",
    description: "指定したタブを閉じます。未保存の変更がある場合は force: true で強制閉じできます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: {
          type: "string",
          description: "閉じるタブのID（designer__list_tabs で取得）",
        },
        force: {
          type: "boolean",
          description: "未保存の変更があっても強制的に閉じる（デフォルト: false）",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "designer__list_tabs",
    description:
      "現在ブラウザで開いているタブの一覧と各タブの未保存状態を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__switch_tab",
    description: "指定したタブをアクティブにします。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: {
          type: "string",
          description: "アクティブにするタブのID（designer__list_tabs で取得）",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "designer__save_screen",
    description:
      "指定した画面の変更をファイルに永続化します。ブラウザのキャッシュをサーバーのファイルに書き込みます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "保存する画面のID",
        },
      },
      required: ["screenId"],
    },
  },
  {
    name: "designer__save_all",
    description:
      "未保存の変更がある全タブをまとめてファイルに永続化します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ── 処理フロー定義ツール ──

  {
    name: "designer__list_process_flows",
    description:
      "処理フロー定義（処理フロー）の一覧を取得します。画面・バッチ・共通処理等のタイプ別に管理されます。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__get_process_flow",
    description:
      "指定した処理フロー定義の詳細（アクション・ステップ含む）を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "取得する処理フローのID",
        },
      },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__add_process_flow",
    description:
      "新しい処理フロー定義（処理フロー）を作成します。生成される ID は kebab-case の EntityId (例: user-login-flow / monthly-batch)。不変識別子は別フィールド meta.uuid (UUID v4) に保持されます (RFC #1284 / #1332)。v3 schema (#1141) に従って meta/context/actions/authoring の 4 並列構造で保存されます。#1263 Phase X1: kind 引数は flowType に rename。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "処理フロー名（例: ログイン画面、月次集計バッチ）",
        },
        flowType: {
          type: "string",
          enum: ["screen", "batch", "scheduled", "system", "common", "other"],
          description: "ProcessFlowKind 種別。v3 discriminator (#8 / #1141 / #1263 Phase X1: meta.kind → meta.flowType): screen=画面、batch=バッチ、scheduled=スケジュール起動、system=システム間、common=共通処理、other=その他。",
        },
        screenId: {
          type: "string",
          description: "紐付く Screen の EntityId (kebab-case、例: 'order-entry-screen')。flowType='screen' の場合に推奨。省略可。RFC #1284 / #1332 で UUID から EntityId 形式に変更。",
        },
        description: {
          type: "string",
          description: "処理フローの説明。省略可。",
        },
      },
      required: ["name", "flowType"],
    },
  },
  {
    name: "designer__update_process_flow",
    description:
      "処理フロー定義を更新します。アクション・ステップを含む完全な定義を渡します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "更新対象の処理フローID",
        },
        definition: {
          type: "object",
          description: "処理フロー定義の完全なJSON（ProcessFlow型）",
        },
      },
      required: ["processFlowId", "definition"],
    },
  },
  {
    name: "designer__delete_process_flow",
    description:
      "処理フロー定義を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "削除する処理フローID",
        },
      },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__add_action",
    description:
      "処理フローにアクション（ボタンクリック等のイベント）を追加します。生成される action ID は LocalId (kebab-case、例: 'act-001' / 'act-002')。#1332 Codex 9 巡目 M3 で UUID v4 採番から LocalId 採番に修正 (schema Action.id は LocalId 規範)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "対象の処理フローの EntityId (kebab-case、例: 'user-login-flow')。",
        },
        name: {
          type: "string",
          description: "アクション名（例: 登録ボタン、検索ボタン）",
        },
        trigger: {
          type: "string",
          enum: ["click", "submit", "select", "change", "load", "timer", "auto", "other"],
          description: "トリガー種別 (auto = 画面ロード時に自動実行)",
        },
      },
      required: ["processFlowId", "name", "trigger"],
    },
  },
  {
    name: "designer__add_step",
    description:
      "アクションにステップ（処理手順）を追加します。生成される step ID は LocalId (kebab-case の短い識別子、例: 'step-01' / 'step-13b-a-01')。v3 schema (#1141) では discriminator は `kind` (旧 `type`) に統一されました。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "対象の処理フローの EntityId (kebab-case、例: 'user-login-flow')。RFC #1284 / #1332 で UUID から EntityId 形式に変更。",
        },
        actionId: {
          type: "string",
          description: "対象のアクションの LocalId (kebab-case の短い識別子、例: 'act-001')",
        },
        kind: {
          type: "string",
          enum: ["validation", "dbAccess", "externalSystem", "commonProcess", "componentCall", "screenTransition", "displayUpdate", "branch", "loop", "loopBreak", "loopContinue", "jump", "compute", "return", "aiCall", "aiAgent", "transactionScope", "workflow", "eventPublish", "eventSubscribe", "log", "audit", "closing", "cdc"],
          description: "v3 ステップ discriminator (#8 / #1141 / #1187)。組み込み 24 variant に完全一致。拡張参照は `namespace:StepName` パターン (例: retail:OrderConfirm) を直接渡す (本 enum は組み込みのみ列挙、拡張は MCP 上は free string で受容)。",
        },
        description: {
          type: "string",
          description: "ステップの処理概要 (v3 schema 上多くの variant で必須)",
        },
        detail: {
          type: "object",
          description: "ステップ種別固有の詳細（tableId, operation, sql 等）。省略可。",
        },
        position: {
          type: "number",
          description: "挿入位置 (0-based index)。省略時は末尾。parentStepId を指定したときは、その親の subSteps の中での位置。",
        },
        parentStepId: {
          type: "string",
          description: "指定すると、その工程の配下 (subSteps、入れ子) に追加する。親の本体の処理のあと、配列順に実行される (docs/spec/process-flow-substeps.md)。省略時はアクション直下。",
        },
      },
      required: ["processFlowId", "actionId", "kind", "description"],
    },
  },
  {
    name: "designer__update_step",
    description:
      "既存ステップの任意フィールドをパッチ更新します。patch にマージされます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string", description: "更新対象の step id (全アクションのネストも走査)" },
        patch: { type: "object", description: "マージするオブジェクト。空オブジェクトは no-op。" },
      },
      required: ["processFlowId", "stepId", "patch"],
    },
  },
  {
    name: "designer__remove_step",
    description: "ステップを削除します。ネスト (branch/loop/subSteps/outcomes.sideEffects) も走査。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string" },
      },
      required: ["processFlowId", "stepId"],
    },
  },
  {
    name: "designer__nest_step",
    description:
      "ステップの入れ子 (subSteps) を動かします。indent = 直前のステップの配下へ入れる (親の本体の処理のあと、配列順に実行される。親の runIf・失敗の扱いが及ぶ)、outdent = 親の次の位置へ出す (後ろにいた兄弟は、出したステップの配下へ引き継ぎ、実行順を変えない)。最初のステップは indent できない。ブラウザで開いている処理フローは、動かせなかったとき (先頭・入れ子の外) も成功を返すことがあるので、結果は処理フローを読んで確認すること。docs/spec/process-flow-substeps.md",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string", description: "対象の処理フローの EntityId (kebab-case)" },
        stepId: { type: "string", description: "動かすステップの LocalId (入れ子の中のステップも指定できる)" },
        direction: { type: "string", enum: ["indent", "outdent"], description: "indent = 直前のステップの配下へ / outdent = 親の次の位置へ" },
      },
      required: ["processFlowId", "stepId", "direction"],
    },
  },
  {
    name: "designer__move_step",
    description: "ステップを同一配列内で並び替えます。異なる親への移動は未対応。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string" },
        newIndex: { type: "number" },
      },
      required: ["processFlowId", "stepId", "newIndex"],
    },
  },
  {
    name: "designer__set_maturity",
    description: "ステップ / アクション / 処理フローの maturity を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        target: { type: "string", enum: ["group", "action", "step"], description: "設定対象" },
        targetId: { type: "string", description: "target=action/step のとき必須" },
        maturity: { type: "string", enum: ["draft", "provisional", "committed"] },
      },
      required: ["processFlowId", "target", "maturity"],
    },
  },
  {
    name: "designer__add_step_note",
    description: "ステップに付箋 (StepNote) を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string" },
        kind: { type: "string", enum: ["assumption", "prerequisite", "todo", "deferred", "question"], description: "Note 種別 (common.v3 Note.kind と同名・同値)" },
        body: { type: "string" },
      },
      required: ["processFlowId", "stepId", "kind", "body"],
    },
  },
  {
    name: "designer__list_response_type_extensions",
    description: "response-types.json に登録されているレスポンス型拡張を一覧します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_response_type_extension",
    description: "response-types.json のレスポンス型拡張を 1 件取得します。",
    inputSchema: {
      type: "object" as const,
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "designer__add_response_type_extension",
    description: "response-types.json にレスポンス型拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string" },
        key: { type: "string" },
        schema: { type: "object" },
        description: { type: "string" },
      },
      required: ["key", "schema"],
    },
  },
  {
    name: "designer__update_response_type_extension",
    description: "response-types.json のレスポンス型拡張を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string" },
        schema: { type: "object" },
        description: { type: "string" },
      },
      required: ["key"],
    },
  },
  {
    name: "designer__delete_response_type_extension",
    description: "response-types.json からレスポンス型拡張を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "designer__list_extension_packages",
    description: "data/extensions/*.json の拡張パッケージ一覧を取得します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_extension_package",
    description: "指定した拡張パッケージを取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        packageName: {
          type: "string",
          enum: ["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"],
        },
      },
      required: ["packageName"],
    },
  },
  {
    name: "designer__add_catalog_entry",
    description: "ProcessFlow レベルのカタログ (errorCatalog / secretsCatalog / externalSystemCatalog) にエントリを追加・更新します。typeCatalog は add_response_type_extension に転送されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        catalog: {
          type: "string",
          enum: ["errorCatalog", "secretsCatalog", "externalSystemCatalog"],
        },
        key: { type: "string", description: "エントリキー (例: STOCK_SHORTAGE / stripeApiKey / ApiError / stripe)" },
        value: { type: "object", description: "エントリの値。全体置換。" },
      },
      required: ["processFlowId", "catalog", "key", "value"],
    },
  },
  {
    name: "designer__remove_catalog_entry",
    description: "ProcessFlow カタログからエントリを削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        catalog: {
          type: "string",
          enum: ["errorCatalog", "secretsCatalog", "externalSystemCatalog"],
        },
        key: { type: "string" },
      },
      required: ["processFlowId", "catalog", "key"],
    },
  },
  {
    name: "designer__list_markers",
    description: "設計 (処理フロー・画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト) の人間→AI マーカー (指示・質問・TODO・チャット) を取得します。マーカーは authoring.markers (位置は anchor)。/designer-work の最初に呼ぶ想定。処理フロー以外では、anchor.fieldPath に設計の中の位置 ($.columns[<カラム id>] / $.items[<項目 id>] / $.layout.nodes[<部品 id>] など) が入る。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["processFlow", "screen", "table", "view", "viewDefinition", "sequence", "pageLayout"], description: "対象の設計の種類 (省略時は processFlow)" },
        entityId: { type: "string", description: "対象の設計の ID (processFlow のときは processFlowId でもよい)" },
        processFlowId: { type: "string", description: "処理フローの ID (entityType=processFlow の別名)" },
        unresolvedOnly: { type: "boolean", description: "true で未解決のみ (既定 true)" },
        stepId: { type: "string", description: "特定 step の marker のみ取得 (処理フロー)" },
        fieldPathPrefix: { type: "string", description: "anchor.fieldPath がこの文字で始まる marker のみ (例: $.columns[)" },
      },
    },
  },
  {
    name: "designer__find_all_markers",
    description: "全設計を横断して未解決マーカーを取得します。/designer-work で「今対応すべき人間指示をまず一望する」ために使用。各マーカーに entityType / entityId / entityName が付く (処理フローには processFlowId / processFlowName も付く)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["processFlow", "screen", "table", "view", "viewDefinition", "sequence", "pageLayout"], description: "特定の種類の設計だけ (省略時は全種類)" },
        unresolvedOnly: { type: "boolean", description: "true で未解決のみ (既定 true)" },
        kind: {
          type: "string",
          enum: ["chat", "attention", "todo", "question"],
          description: "特定 kind のみ抽出 (省略時は全 kind)",
        },
      },
    },
  },
  {
    name: "designer__add_marker",
    description: "設計にマーカーを追加します。AI 側からの質問・返信・報告等を人間に届ける用途。位置は stepId (処理フロー) または fieldPath ($.columns[<カラム id>] など) で指す。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["processFlow", "screen", "table", "view", "viewDefinition", "sequence", "pageLayout"], description: "対象の設計の種類 (省略時は processFlow)" },
        entityId: { type: "string", description: "対象の設計の ID (processFlow のときは processFlowId でもよい)" },
        processFlowId: { type: "string", description: "処理フローの ID (entityType=processFlow の別名)" },
        kind: { type: "string", enum: ["chat", "attention", "todo", "question"], description: "Marker 種別 (schema の \"validator\" は意図的に除外 — validator marker は validator runtime のみが追加可能、AI 手動付与は想定外)" },
        body: { type: "string" },
        stepId: { type: "string", description: "紐付ける step id (処理フロー。省略時は設計全体宛)" },
        fieldPath: { type: "string", description: "設計の中の位置 (例: $.columns[col-02] / $.items[email] / $.layout.nodes[form-1])" },
        author: { type: "string", enum: ["human", "ai"], description: "既定 \"ai\"" },
      },
      required: ["kind", "body"],
    },
  },
  {
    name: "designer__resolve_marker",
    description: "マーカーを解決済みにします。resolution コメントを付与して人間に応答内容を伝える。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["processFlow", "screen", "table", "view", "viewDefinition", "sequence", "pageLayout"], description: "対象の設計の種類 (省略時は processFlow)" },
        entityId: { type: "string", description: "対象の設計の ID (processFlow のときは processFlowId でもよい)" },
        processFlowId: { type: "string", description: "処理フローの ID (entityType=processFlow の別名)" },
        markerId: { type: "string" },
        resolution: { type: "string", description: "AI 側の対応メモ (例: \"sql を修正しました\")" },
      },
      required: ["markerId"],
    },
  },
  // ── 画面項目 ID リネーム ──

  {
    name: "designer__get_rename_context",
    description:
      "指定画面の未命名画面項目 (自動生成 ID のもの) と周辺 HTML コンテキストを返します。" +
      "呼び出し元 (Claude) がこの情報を基に {oldId: newId} マッピングを推論し、" +
      "designer__apply_rename_mapping で適用します。命名済み項目は含まれません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面 ID" },
      },
      required: ["screenId"],
    },
  },

  {
    name: "designer__apply_rename_mapping",
    description:
      "画面項目 ID を一括リネームします。mapping の各エントリに対して rename_screen_item を順次実行し、" +
      "処理フローの screenItemRef も自動追従します。1 件の失敗は後続エントリの処理を止めません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面 ID" },
        mapping: {
          type: "object",
          description: "{oldId: newId} 形式のマッピング。newId は camelCase の有効な JS 識別子 (30 字以内)。",
          additionalProperties: { type: "string" },
        },
      },
      required: ["screenId", "mapping"],
    },
  },

  {
    name: "designer__rename_screen_item",
    description:
      "画面項目の ID を変更し、参照する全処理フローの screenItemRef を自動追従させます。" +
      "oldId → newId のリネームが画面 HTML の name/id 属性と screen-items JSON にも反映されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面ID" },
        oldId:    { type: "string", description: "変更前の業務識別子" },
        newId:    { type: "string", description: "変更後の業務識別子 (有効な JS 識別子)" },
      },
      required: ["screenId", "oldId", "newId"],
    },
  },

  {
    name: "designer__check_screen_item_refs",
    description:
      "画面項目 ID を変更したときに影響を受ける処理フローの一覧と件数を返します。" +
      "rename_screen_item の実行前に呼び出して影響範囲を確認するために使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面ID" },
        itemId:   { type: "string", description: "確認する業務識別子" },
      },
      required: ["screenId", "itemId"],
    },
  },

  {
    name: "designer__remove_marker",
    description: "マーカーを完全削除します (resolve とは別、履歴から消す)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["processFlow", "screen", "table", "view", "viewDefinition", "sequence", "pageLayout"], description: "対象の設計の種類 (省略時は processFlow)" },
        entityId: { type: "string", description: "対象の設計の ID (processFlow のときは processFlowId でもよい)" },
        processFlowId: { type: "string", description: "処理フローの ID (entityType=processFlow の別名)" },
        markerId: { type: "string" },
      },
      required: ["markerId"],
    },
  },

  {
    name: "designer__export_arazzo",
    description:
      "ProcessFlow 内の ExternalSystemStep を Arazzo 1.0 YAML / JSON として出力します。" +
      "フロー中の外部 API 呼び出しを Arazzo ワークフロー形式にエクスポートし、OpenAPI ツールとの連携に利用できます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "対象フロー ID",
        },
        outputFormat: {
          type: "string",
          enum: ["yaml", "json"],
          description: "出力形式。デフォルト: yaml",
        },
      },
      required: ["processFlowId"],
    },
  },

  {
    name: "designer__solution_pack",
    description:
      "指定した処理フロー群を solution ZIP ファイルにパッケージングします。" +
      "プロジェクト間でフロー定義を配布・共有するための pack 機能 (Power Platform Solution 相当)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowIds: {
          type: "array",
          items: { type: "string" },
          description: "ZIP に同梱するフロー ID の配列",
        },
        publisherPrefix: {
          type: "string",
          description: "プロジェクト識別子 (ID 衝突防止プレフィックス, 例: myapp)",
        },
        version: {
          type: "string",
          description: "バージョン文字列 (例: 1.0.0)",
        },
        outputPath: {
          type: "string",
          description: "出力先 .zip パス (絶対パスまたは data/ からの相対パス)",
        },
      },
      required: ["processFlowIds", "publisherPrefix", "version", "outputPath"],
    },
  },

  {
    name: "designer__solution_unpack",
    description:
      "solution ZIP ファイルを展開し、フロー定義を data/actions/ に取り込みます。" +
      "solution_pack で作成した ZIP を別プロジェクトで展開する unpack 機能。",
    inputSchema: {
      type: "object" as const,
      properties: {
        inputPath: {
          type: "string",
          description: "展開する .zip パス (絶対パスまたは data/ からの相対パス)",
        },
        conflictResolution: {
          type: "string",
          enum: ["skip", "overwrite", "rename"],
          description: "ID 衝突時の解決方針。skip: 既存を維持 / overwrite: 上書き / rename: プレフィックス付きで保存。デフォルト: skip",
        },
        publisherPrefix: {
          type: "string",
          description: "conflictResolution=rename 時に ID の先頭に付与するプレフィックス (例: myapp)。省略時は \"imported\"",
        },
      },
      required: ["inputPath"],
    },
  },

  // ── 拡張ポイント 専用ツール (#445) ──

  {
    name: "designer__add_step_extension",
    description: "data/extensions/steps.json にステップ拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間 (空文字列可)" },
        key: { type: "string", description: "ステップキー (例: BatchStep)" },
        schema: { type: "object", description: "動的フォーム生成スコープのサブセット" },
        label: { type: "string" },
        icon: { type: "string" },
        description: { type: "string" },
      },
      required: ["namespace", "key", "schema"],
    },
  },

  {
    name: "designer__add_field_type_extension",
    description: "data/extensions/field-types.json にフィールド型拡張を追加します。既存 kind は上書きします。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間" },
        kind: { type: "string", description: "FieldType の kind 値" },
        label: { type: "string" },
      },
      required: ["namespace", "kind", "label"],
    },
  },

  {
    name: "designer__add_trigger_extension",
    description: "data/extensions/triggers.json にトリガー拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間" },
        value: { type: "string", description: "ActionTrigger の enum 値 (例: webhook, mq)" },
        label: { type: "string", description: "UI 表示ラベル (日本語可)" },
      },
      required: ["namespace", "value", "label"],
    },
  },

  {
    name: "designer__add_db_operation_extension",
    description: "data/extensions/db-operations.json に DB 操作拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間" },
        value: { type: "string", description: "DbOperation の enum 値 (例: TRUNCATE, MERGE)" },
        label: { type: "string", description: "UI 表示ラベル (日本語可)" },
      },
      required: ["namespace", "value", "label"],
    },
  },

  {
    name: "designer__remove_extension",
    description: "拡張エントリを 1 件削除します。type に応じたファイルから該当エントリを取り除きます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"],
          description: "拡張種別",
        },
        namespace: { type: "string", description: "名前空間" },
        key: { type: "string", description: "steps / responseTypes 用キー" },
        value: { type: "string", description: "fieldTypes:kind / triggers:value / dbOperations:value" },
      },
      required: ["type", "namespace"],
    },
  },

  {
    name: "designer__list_extensions",
    description: "data/extensions/ の全拡張 (steps / fieldTypes / triggers / dbOperations / responseTypes) を一括取得します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },

  // ── ワークスペース管理 (#671) ─────────────────────────────────────
  {
    name: "designer__workspace_list",
    description: "最近使ったワークスペース一覧と現在 active なワークスペース、lockdown 状態を返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_status",
    description: "現在 active なワークスペースの絶対パス・名前・lockdown フラグを返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_open",
    description: "指定 path または id のワークスペースを active にし、recent に upsert します。init=true 指定時は path のフォルダを作成し harmony.json を初期化してから open します。lockdown モード時は error を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "ワークスペースの絶対パス。id と排他、どちらか必須。" },
        id: { type: "string", description: "recent 上の workspace id。path と排他。" },
        init: { type: "boolean", description: "true の場合、path のフォルダ作成と harmony.json 初期化を行ってから open します (path 必須)。" },
        dataDir: { type: "string", description: "init=true 時のデータディレクトリ名 (省略時: 'harmony')。harmony.json の dataDir フィールドに設定されます。" },
      },
      required: [],
    },
  },
  {
    name: "designer__workspace_inspect",
    description: "指定 path のフォルダ状態を判定して返します。status は 'ready' (harmony.json あり + schema 検証 pass), 'needsInit' (harmony.json なし), 'notFound' (フォルダ無し), 'invalid' (harmony.json が JSON 不正 or schema 違反) のいずれか。",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "判定対象の絶対パス" },
      },
      required: ["path"],
    },
  },
  {
    name: "designer__workspace_close",
    description: "現在 active なワークスペースを閉じます (active = null)。lockdown モード時は error を返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_remove",
    description: "recent からワークスペースエントリを除外します (fs は変更しません)。lockdown モード時は error を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "recent 上の workspace id" },
      },
      required: ["id"],
    },
  },
  // draft__ / lock__ tools 削除済 (Phase 6 #903)
  // 旧 draft__read / draft__update / draft__commit / draft__discard / draft__has / draft__list /
  // lock__acquire / lock__release / lock__forceRelease / lock__get / lock__list は Phase 6 (#903) で削除。
  // editSession.* API が正規経路。

  // ── EditSession MCP tools (#906) ──────────────────────────────────────────────
  // AI エージェント (MCP 経由) が edit-session を直接操作するための tool 群。
  // 旧 draft__/lock__ の MCP tool 削除に伴う後継。実装は wsBridge の editSession* 公開 API
  // を adapter として呼ぶ (WS handler と共有)。spec docs/spec/edit-session-protocol.md 準拠。
  {
    name: "editSession__create",
    description:
      "新規 EditSession を作成して initial Edit participant として登録します。" +
      "指定 resource (画面 / テーブル / 処理フロー等) の編集セッションを開始する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        resourceType: {
          type: "string",
          // #1374: editSessionStore.ts の DRAFT_RESOURCE_TYPES (source of truth) から
          // 直接参照。旧 inline 列挙は #1368 で `generic-definition` 等の追加追従漏れが
          // 発生していた (MCP enum と runtime allowlist の drift)。
          enum: [...DRAFT_RESOURCE_TYPES],
          description: "編集対象 resource の種別",
        },
        resourceId: { type: "string", description: "編集対象 resource の ID (singleton resource は \"singleton\" 等)" },
        displayLabel: { type: "string", description: "participant の表示名 (例: \"山田\" / AI は末尾に @AI を付けた \"Alice@AI\"。画面は末尾の @AI で AI を見分ける)。省略時は sessionId" },
      },
      required: ["resourceType", "resourceId"],
    },
  },
  {
    name: "editSession__attach_as_view",
    description:
      "既存 EditSession に View role で attach します。response に現在の payload + sequence が含まれます。" +
      "別エージェントが編集中の resource を観察 / 引き継ぎ準備する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        displayLabel: { type: "string", description: "participant の表示名。省略時は sessionId" },
        parentHumanSessionId: { type: "string", description: "AI participant の場合、指示元 human の sessionId" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__detach",
    description:
      "EditSession から完全離脱します。Edit role の場合は事前に View に降格 (set_role) する必要があります。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__set_role",
    description:
      "自身の participant role を変更します。通常は take-over (transfer_edit) を使い、本 tool は限定的な role 変更用 (Edit → View 降格等)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        role: { type: "string", enum: ["Edit", "View"], description: "新しい role" },
      },
      required: ["editSessionId", "role"],
    },
  },
  {
    name: "editSession__transfer_edit",
    description:
      "Edit role を atomic に take-over します。caller が new Edit holder になり、現 Edit holder は View に降格します。" +
      "事前に attach_as_view で View 参加していること (spec §7.2)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__update",
    description:
      "EditSession の payload を更新し sequence を increment します。FS write はせず in-memory snapshot のみ更新 (Forward-Compat 原則)。" +
      "AI が draft 編集を反映する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        payload: { description: "新しい payload (opaque、resourceType ごとに schema が異なる)" },
      },
      required: ["editSessionId", "payload"],
    },
  },
  {
    name: "editSession__save",
    description:
      "EditSession の現時点 payload を本体ファイルに確定保存します (saveHistory 記録 + broadcast 含む)。" +
      "spec §9.3 last-save-wins: 衝突時は { ok: false, conflict } を返します。" +
      "stage パラメータで 2 段階保存をサポート (checkOnly / commit)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        force: { type: "boolean", description: "true で衝突 check skip (overwrite 確認後)" },
        stage: {
          type: "string",
          enum: ["checkOnly", "commit"],
          description: "checkOnly = 衝突 check のみ / commit = saveHistory 記録 + broadcast (衝突 check skip)",
        },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__discard",
    description:
      "EditSession を Active → Discarded に遷移させます。draft が破棄され retention 期間 (7日) 後に完全削除されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__list",
    description:
      "EditSession 一覧を取得します。resourceType + resourceId 指定で絞り込み、未指定で全件返却。",
    inputSchema: {
      type: "object" as const,
      properties: {
        resourceType: {
          type: "string",
          // #1374: editSessionStore.ts の DRAFT_RESOURCE_TYPES (source of truth) を共有。
          // 旧 inline 列挙は editSession__create 側と drift しており、`page-layout` /
          // `er-layout` / `generic-definition` の 3 type が漏れて MCP `editSession__list`
          // から filter できなくなっていた。
          enum: [...DRAFT_RESOURCE_TYPES],
          description: "絞り込み: resource 種別",
        },
        resourceId: { type: "string", description: "絞り込み: resource ID (resourceType と同時指定)" },
      },
      required: [],
    },
  },
  {
    name: "editSession__fetch_payload",
    description:
      "EditSession の現在の payload + sequence を取得します (broadcast 待ちなし)。" +
      "別 session が attach した直後の initial fetch や、cross-session take-over 後の同期に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
];
