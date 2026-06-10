# path-conventions.md

Harmony の永続化対象データの配置規約と、container 配布時の mount 設計指針。

関連: #1055 (本仕様の根拠 ISSUE) / [edit-session-draft.md](edit-session-draft.md) / [workspace.md](workspace.md)

## 1. 永続化データのカテゴリ

Harmony が扱うデータは性質によって 3 つに分類される。配置先と mount 戦略はカテゴリごとに異なる。

| カテゴリ | 例 | 性質 | 配置 |
|---------|-----|-----|-----|
| **(a) Harmony state** | `recent-workspaces.json` (recent index) / 将来の AI cache / preferences | machine-specific なユーザー履歴 | `HARMONY_HOME` 配下 |
| **(b) workspace 成果物** | `<workspace>/harmony.json` / `screens/` / `tables/` / `process-flows/` / `extensions/` / `.drafts/` | 業務設計の成果物、Git 管理対象 | ユーザーが任意配置 (絶対パス) |
| **(c) built-in リソース** | `data/extensions/` (組み込み拡張定義 — field-types / response-types 等) | 配布物の一部、read-only | image 内に焼き込み |

## 2. `HARMONY_HOME` 環境変数

カテゴリ (a) の置き場を指定する。

```
default: ~/.harmony
内容例:
  ~/.harmony/recent-workspaces.json
  ~/.harmony/ai-cache/  (将来)
```

優先順位 (`recentStore.ts` 実装):

1. **`DESIGNER_RECENT_FILE`** — full file path、テスト / 拡張 sandbox 用
2. **`HARMONY_HOME`** — ディレクトリ path。recent-workspaces.json は `<HARMONY_HOME>/recent-workspaces.json`
3. **default** — `~/.harmony/recent-workspaces.json`

container 内では `HARMONY_HOME=/home/node/.harmony` を ENV で指定し、`VOLUME ["/home/node/.harmony"]` を Dockerfile で宣言する (本リポの `Dockerfile` 参照)。

## 3. workspaces 親ディレクトリ規約

カテゴリ (b) は**規約上の親ディレクトリを強制しない**。`recent-workspaces.json` 内に各 workspace の**絶対パス**が記録される設計のため、workspace 実体はファイルシステム上のどこにあってもよい。

ただし container 配布時の**推奨**として `/data/workspaces/` を親ディレクトリにし、`VOLUME ["/data/workspaces"]` を Dockerfile で宣言する。利用者はこの親パスを host bind mount するか named volume にする。

```
/data/workspaces/         ← 親 (mount point、本ファイル自体は空)
├── my-app/               ← workspace 1
│   ├── harmony.json
│   ├── screens/
│   ├── tables/
│   ├── process-flows/
│   └── .drafts/          ← edit session drafts (active workspace 配下、#683)
├── another-app/          ← workspace 2
│   └── harmony.json
└── ...
```

利用者は UI の「追加」ボタンで `/data/workspaces/my-app` のような絶対パスを入力 → `recent-workspaces.json` に登録される (現行 flow と同じ)。

## 4. mount 戦略マトリクス

container 配布時、カテゴリ別に named volume / host bind を選ぶ:

| カテゴリ | 推奨 | 理由 |
|---------|-----|------|
| (a) `HARMONY_HOME` | **named volume** | machine-specific、host 直接アクセス不要、container 廃止で痕跡残らないのが望ましい |
| (b) workspaces 親 | **host bind mount** | Git 管理対象、host 上の他ツール (IDE / GUI) で編集する可能性、バックアップを host 側で取りたい |
| (c) built-in リソース | mount 不要 | image 同梱 |

### named volume vs host bind の差 (再掲)

| 方式 | 書き方 | host から見える | 移植性 |
|------|--------|---------------|--------|
| **named volume** | `source=<名前>,target=<container path>,type=volume` | docker volume inspect 経由のみ | volume 名で再生成可、別マシン移行は `docker volume export/import` |
| **host bind mount** | `source=<host path>,target=<container path>,type=bind` | host で普通にアクセス可 | host fs が永続する限り永続 |

## 5. devcontainer.json (本リポの開発環境)

開発用 Dev Container は本リポの `.devcontainer/devcontainer.json` で named volume 3 種類を mount している:

```jsonc
"mounts": [
  "source=harmony-claude,target=/home/node/.claude,type=volume",
  "source=harmony-codex,target=/home/node/.codex,type=volume",
  "source=harmony-state,target=/home/node/.harmony,type=volume"
]
```

- `harmony-claude` / `harmony-codex`: AI tool 設定 (auth 等)
- `harmony-state`: Harmony state (recent-workspaces.json 等、本仕様の (a))

workspaces 成果物 (b) は project bind mount (`/workspaces/harmony/workspaces/`) に内包される (現行 dev container の host bind mount を流用)。

## 6. 配布シナリオ別 docker-compose 例

将来 `harnize/harmony:1.0` を公開した時の利用者側 docker-compose 例。

### 6.1 個人 PC で 1 user が使う想定 (典型)

```yaml
# docker-compose.yml
services:
  harmony:
    image: harnize/harmony:1.0
    ports:
      - "5179:5179"
    volumes:
      - harmony-state:/home/node/.harmony   # (a) state は named volume
      - ~/projects:/data/workspaces          # (b) 成果物は host の ~/projects に bind
    environment:
      HARMONY_HOME: /home/node/.harmony
volumes:
  harmony-state:
```

利用者は `~/projects/<任意名>/` 配下に harmony.json を含むワークスペースを置く。Harmony UI から `/data/workspaces/<任意名>` を絶対パスで「追加」する。

### 6.2 host を一切汚さない想定 (CI / 一時起動)

```yaml
services:
  harmony:
    image: harnize/harmony:1.0
    ports:
      - "5179:5179"
    volumes:
      - harmony-state:/home/node/.harmony
      - harmony-workspaces:/data/workspaces   # (b) も named volume にする
volumes:
  harmony-state:
  harmony-workspaces:
```

利用者はワークスペースを host から直接編集できないが、container 完全 isolation が取れる。

### 6.3 SaaS 配布の場合 (multi-tenant)

file system による state 管理は行わず、DB の users / workspaces テーブルに格納する。本ファイル外。

## 7. L1 / L2 / L3 スコープ

L1 (本 ISSUE #1055): path 規約 + 最小 Dockerfile (backend のみ) + devcontainer 永続化。**配布の約束はしない**。

L2 (#1472): frontend 同梱、backend が静的配信、healthcheck 追加、self-host できる image。利用者が「1 container で全部動く」状態。Docker build / smoke は Dev Container 内ではなく host WSL2/Linux の `scripts/build-harmony-image.sh` / `scripts/smoke-harmony-image.sh` で行う。

L3 (将来): 公開配布。multi-arch (amd64/arm64) build、image tag 戦略、SBOM、脆弱性スキャン、リリースノート連携。

### L2 image の同梱範囲

root `Dockerfile` は以下を image 内へ同梱する:

- `backend/dist/`
- `frontend/dist/`
- `shared/dist/`
- production `node_modules`
- `data/extensions/`

runtime は `HARMONY_STATIC_DIR=/app/frontend/dist` を設定し、backend の HTTP fallback が SPA を静的配信する。`data/extensions/` は built-in リソースとして image に焼き込むため、配布利用者は別途 mount しない。

## 8. 既知の課題 / 設計判断

### `workspace.browseFs` のセキュリティ (#1056)

L1 段階では backend folder browser API は**ホスト fs 全体をブラウズ可能**で、allowlist を強制しない (`path.resolve` で `../` 経由の relative escape のみ正規化)。

理由: container 配布前提の path 規約フェーズであり、本格的な permission system は L2/L3 の認証・認可設計と一体で組む方が筋がよい。L1 では「container 内で動く前提なので fs 全体に意味のあるアクセス制御をかける必要が薄い」「dev 環境では開発者本人が UI を操作する前提」と整理する。

将来 SaaS / multi-tenant 化時には `HARMONY_ALLOWED_BROWSE_ROOTS` 等で制限する仕様を別 ISSUE で追加する。
