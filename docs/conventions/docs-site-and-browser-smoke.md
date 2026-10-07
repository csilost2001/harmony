# Documentation HTML サイトと AI ブラウザ確認

AGENTS.md から移設した詳細版 (2026-10-08)。

### Documentation HTML サイト (docs-site/)

仕様書 / プレゼン HTML 化サイト (Astro 5 + Tailwind v4 + pagefind + rehype-mermaid)。詳細は [`docs-site/README.md`](docs-site/README.md) 参照。メタ ISSUE: [#1124](https://github.com/csilost2001/harmony/issues/1124) (Phase A-E 完了済)。

#### 出力構成

- **Source of truth (canonical)**: `docs/spec/*.md` / `docs/user-guide/*.md` / `docs/conventions/*.md` / `docs/setup/*.md` (Markdown が一次成果物)
- **Build artifact (配布物)**: `docs/html/` (git tracked、**手編集禁止**)
- **プレゼン**: `docs/html/presentation/index.html` (1 ファイル完結、Swiper、16 スライド)

#### 初回セットアップ

```bash
cd docs-site
npm install
npx playwright install chromium  # rehype-mermaid 用、初回のみ
```

#### 更新フロー (md 編集後の必須手順)

1. `docs/spec/*.md` 等の Markdown を編集 (canonical source)
2. `cd docs-site && npm run build` で `docs/html/` を再生成
   - `npm run build` は毎回 `.astro/` cache を clear してから build (Astro 5 cache stale state による link resolution 破壊を防止、ISSUE #1366)
3. `git add docs/html/ docs-site/` で commit
4. push / PR

#### スキーマ反映

`schemas/v3/*.json` 変更時:

- `SchemaTable` component が build 時に schema を再読込
- 上記更新フローと同じ手順で HTML に反映 (rebuild 必須)

#### ローカル閲覧

build 後の HTML を browser で開く方法。**`npm run build` の post-process で全 HTML/CSS/JS の絶対パス (`/foo/`) を相対パス (`./foo/` or `../../foo/`) に書き換え済** (`docs-site/scripts/relativize-html-paths.mjs`)、両方対応:

1. **静的に開く** (file:// プロトコル、リンク + asset + 検索 UI 全動作):
   - Linux: `xdg-open docs/html/index.html`
   - macOS: `open docs/html/index.html`
   - Windows: `start docs\html\index.html`
   - Windows + WSL2: explorer から `\\wsl.localhost\<distro>\home\<user>\projects\harmony\docs\html\index.html` を double click
2. **preview server で開く** (HTTP server、開発時の live reload 等):
   ```bash
   cd docs-site
   npm run preview
   # → http://127.0.0.1:4321/
   ```

注意: post-process script は `npm run build` で自動実行されるため、build artifact を直接 push する前提で機能する。手動で `astro build` のみ実行した場合は別途 `node scripts/relativize-html-paths.mjs` が必要。

#### AI による browser smoke test (Playwright / chrome-devtools MCP)

AI セッション内で `docs/html/` を実機 browser で smoke test する手順 (2026-05-17 設定済、`.mcp.json` で bundled chromium 利用)。

##### 起動モード 3 種類

| モード | MCP server entry | 用途 | デフォルト |
|---|---|---|---|
| **headless** | `playwright` / `chrome-devtools` | AI 完全自動 smoke、CI 用 | ✅ 原則これ |
| **headed (on-demand)** | `playwright-headed` / `chrome-devtools-headed` | ユーザーが動作を **目視確認したい時のみ** | ユーザー要望時 |
| **trace 再生** | (将来) | 事後 review | 未実装 |

##### AI 判断基準 (重要)

- **デフォルト = headless**: ユーザーから明示要望がない限り `mcp__playwright__*` (headless) を使う
- **headed 切替条件**: ユーザーが以下のような発話をした時 **のみ** `mcp__playwright-headed__*` / `mcp__chrome-devtools-headed__*` を使う:
  - 「動作を見たい」「画面を見せて」「目視確認したい」「headed で」「window で開いて」等
- headed mode 中もユーザーが操作・観察できる (Windows desktop に window が立ち上がる、Dev Container では WSLg の X11 fallback 経由)
- headed task 完了後は **次の自動 smoke から headless に戻す** (永続切替しない)

##### 基本手順

1. **preview server を立てる** (background or 別ターミナル):
   ```bash
   cd docs-site && npm run preview
   # → http://127.0.0.1:4321/
   ```
2. **Playwright MCP で navigate + screenshot + console 確認** (軽量、推奨):
   - headless: `mcp__playwright__browser_navigate` → `http://127.0.0.1:4321/`
   - headed: `mcp__playwright-headed__browser_navigate` → ユーザー目視可
   - `mcp__playwright__browser_take_screenshot` → `.tmp/screenshots/` に保存
   - `mcp__playwright__browser_console_messages` (level: error) で JS エラー確認
   - `mcp__playwright__browser_snapshot` で a11y tree から click 対象特定
3. **chrome-devtools MCP** (Lighthouse / network 等の DevTools features 必要時):
   - 同様に headless / headed 切替可

##### 環境前提

| OS / 環境 | headed 動作 |
|---|---|
| Windows 11 + WSL2 + Docker Desktop (Dev Container) | ✅ WSLg の X11 fallback 経由で Windows desktop に自動表示 (推奨環境)。`/run/user/<uid>/wayland-0` の bind mount エラーが出る環境では VS Code user settings で `dev.containers.mountWaylandSocket=false` を設定する (#1451) |
| Windows 11 + WSL2 native (Dev Container なし) | ✅ WSLg 直接利用 |
| Windows 10 + WSL2 + Docker Desktop | ⚠️ VcXsrv / X410 等の X server 別途必要 (未対応) |
| macOS | ⚠️ XQuartz install + `xhost +localhost` + `DISPLAY=host.docker.internal:0` (未対応) |
| Linux native | ⚠️ X11 forwarding 手動 setup (未対応) |

未対応環境では `.devcontainer/devcontainer.json` の WSLg 関連 mount (`/tmp/.X11-unix`, `/mnt/wslg`) を comment out + headed mode 利用断念。Wayland socket の自動 mount は repo から強制停止できないため、`/run/user/<uid>/wayland-0` の bind mount エラーが出る環境では VS Code user settings に `"dev.containers.mountWaylandSocket": false` を設定する。

##### 注意事項

- `.mcp.json` / devcontainer.json の MCP / browser 設定変更後は **claude code 再起動 + (devcontainer の場合) container rebuild** が必要
- 詳細 pitfall は memory `feedback_browser_smoke_headless_chrome_devtools.md` 参照

##### 事前準備済 bundled browser

- Playwright chromium: `~/.cache/ms-playwright/chromium-1217/`, `chromium-1223/`
- Chrome for Testing: `~/.cache/puppeteer/chrome/linux-150.0.7843.0/chrome-linux64/chrome` (chrome-devtools MCP 用)

#### 注意事項

- **`docs/html/` 配下の手編集は禁止** (build artifact、次回 build で上書きされる)
- `_astro/*.{css,js}` の hash 名は内容変化で変わる (commit diff 増加要因、想定済)
- pagefind index (`docs/html/pagefind/`) も build 毎に再生成 (`.pf_index` / `.pf_fragment` の hash 変動)
- **Astro 5 系を採用** (Astro 6 は Node 22+ 必須、本プロジェクト Node 20 環境のため不適合)
- mermaid 図は build-time SVG 生成 (Playwright chromium 経由、client JS 不要)
- 内部 `*.md` link は rehype plugin で自動的に Astro route (`/<area>/<slug>/`) に変換、4 area 外 link は GitHub blob URL に fallback

