#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-local}"
IMAGE="${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:${VERSION}}"
PORT="${HARMONY_SMOKE_PORT:-5179}"
CONTAINER_NAME="harmony-smoke-${PORT}"
ENGINE="${CONTAINER_ENGINE:-docker}"

if ! command -v "${ENGINE}" >/dev/null 2>&1; then
  echo "${ENGINE} command not found. Set CONTAINER_ENGINE=docker or CONTAINER_ENGINE=podman and run this on the host." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node command not found. Run this script from the Harmony host checkout after npm install." >&2
  exit 1
fi

cleanup() {
  "${ENGINE}" rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 公開するポートが host で使われていると、docker run が exit 125 (ports are not available) で落ちるので、先に確かめる
if ! HARMONY_SMOKE_PORT="${PORT}" node -e '
const net = require("net");
const srv = net.createServer();
srv.once("error", () => process.exit(1));
srv.listen(Number(process.env.HARMONY_SMOKE_PORT), "127.0.0.1", () => srv.close(() => process.exit(0)));
'; then
  echo "ポート ${PORT} は使われています。HARMONY_SMOKE_PORT=5189 のように別のポートを指定してください" >&2
  exit 1
fi

cleanup
"${ENGINE}" run -d \
  --name "${CONTAINER_NAME}" \
  -p "127.0.0.1:${PORT}:5179" \
  -e HARMONY_TRUST_LOCALHOST_PUBLISHED_PORT=1 \
  -v "harmony-smoke-state:/home/node/.harmony" \
  -v "harmony-smoke-workspaces:/data/workspaces" \
  "${IMAGE}" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/" | grep -qi '<!doctype html'
curl -fsS \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"harmony-smoke","version":"1"}}}' \
  "http://127.0.0.1:${PORT}/mcp" | grep -q 'harmony-mcp'

# WebSocket の確認。host の node_modules に頼らないよう、Node 組み込みの WebSocket (Node 22 以降) を使う
HARMONY_SMOKE_PORT="${PORT}" node -e '
if (typeof WebSocket === "undefined") {
  console.error("この Node (" + process.version + ") には組み込みの WebSocket がありません。Node 22 以降で実行してください");
  process.exit(1);
}
const port = process.env.HARMONY_SMOKE_PORT;
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const timer = setTimeout(() => {
  console.error("WebSocket smoke timeout");
  process.exit(1);
}, 3000);
// サーバは origin / 接続トークンの検査に落ちても、いったん接続を受けてから 1008 で閉じる。open が来ただけで通ったことにせず、
// open のあと少し待って、サーバ側から閉じられていない (close が来ない) ことまで確かめる
ws.addEventListener("open", () => {
  clearTimeout(timer);
  const wait = setTimeout(() => { ws.close(); process.exit(0); }, 500);
  ws.addEventListener("close", (ev) => {
    clearTimeout(wait);
    console.error(`WebSocket が接続の直後に閉じられました (code ${ev.code} ${ev.reason || ""})。origin / 接続トークンの検査に落ちた可能性があります`);
    process.exit(1);
  });
});
ws.addEventListener("error", (ev) => {
  clearTimeout(timer);
  console.error(ev.message || "WebSocket の接続に失敗しました");
  process.exit(1);
});
'

# 配布 image の中身の確認 (#1577)。
# (1) /app/build-info.json の commit が、image の label (org.opencontainers.image.revision) と一致し、MCP の designer__workspace_status の harmony.commit と一致すること。
#     HARMONY_SMOKE_EXPECT_COMMIT (build のときの完全な commit) を渡したときだけ、それとも一致すること。渡さなければ host の checkout の HEAD とは照合しない
#     (build のあとに host で commit した・pull した、別の image を確かめることがあるため。違うときは注意を出すだけ)
#     (commit を記録していない image = git の作業コピーでなく作った image は、この確認を飛ばす)
# (2) 開発コンテナの雛形 (generate-code の 4 組合せ × 7 ファイル) が /app/ai-skills の中にあること (designer__get_scaffold_update が読む)
BUILD_INFO="$("${ENGINE}" exec "${CONTAINER_NAME}" cat /app/build-info.json)" || {
  echo "image に /app/build-info.json がありません (Dockerfile の build-info の書き込みを確認してください)" >&2
  exit 1
}
IMAGE_COMMIT="$(printf '%s' "${BUILD_INFO}" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).commit||""))}catch{}})')"
if [ -n "${IMAGE_COMMIT}" ]; then
  LABEL_COMMIT="$("${ENGINE}" inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${CONTAINER_NAME}")"
  if [ "${LABEL_COMMIT}" != "${IMAGE_COMMIT}" ]; then
    echo "image の label の revision (${LABEL_COMMIT}) が build-info.json の commit (${IMAGE_COMMIT}) と違います" >&2
    exit 1
  fi
  if [ -n "${HARMONY_SMOKE_EXPECT_COMMIT:-}" ]; then
    if [ "${HARMONY_SMOKE_EXPECT_COMMIT}" != "${IMAGE_COMMIT}" ]; then
      echo "build-info.json の commit (${IMAGE_COMMIT}) が、HARMONY_SMOKE_EXPECT_COMMIT (${HARMONY_SMOKE_EXPECT_COMMIT}) と違います" >&2
      exit 1
    fi
  else
    HOST_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
    if [ -n "${HOST_HEAD}" ] && [ "${HOST_HEAD}" != "${IMAGE_COMMIT}" ]; then
      echo "注意: image の commit (${IMAGE_COMMIT:0:7}) が、host の checkout の HEAD (${HOST_HEAD:0:7}) と違います。build のあとに commit した・別の image を確かめている場合は問題ありません。照合するなら HARMONY_SMOKE_EXPECT_COMMIT を指定してください" >&2
    fi
  fi
  HARMONY_SMOKE_PORT="${PORT}" HARMONY_SMOKE_COMMIT="${IMAGE_COMMIT}" node -e '
const port = process.env.HARMONY_SMOKE_PORT;
const want = process.env.HARMONY_SMOKE_COMMIT.slice(0, 7);
fetch(`http://127.0.0.1:${port}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "designer__workspace_status", arguments: {} } }),
}).then(async (res) => {
  const text = await res.text();
  // JSON の返答か、SSE (data: 行) のどちらでも読む
  const data = text.trim().startsWith("{") ? text : text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  const status = JSON.parse(JSON.parse(data).result.content[0].text);
  if (!status.harmony || status.harmony.commit !== want || status.harmony.source !== "image") {
    console.error(`workspace_status の harmony が build の commit (${want}・source image) と一致しません: ${JSON.stringify(status.harmony)}`);
    process.exit(1);
  }
}).catch((err) => { console.error(`workspace_status の確認に失敗しました: ${err.message}`); process.exit(1); });
'
else
  echo "注意: build-info.json に commit がない image です (git の作業コピーでなく作った)。commit の一致の確認を飛ばします" >&2
fi

# (3) 画面「版と更新」のリリースノート (/app/docs/release-notes.md) が、image の commit までの履歴から作られていること
#     (scripts/build-harmony-image.sh の --build-context での差し替えが効いたか)。先頭の数行に、image の commit の題名があること。
#     build script を通さず docker build だけで作った image では差し替わらないので、HARMONY_SMOKE_SKIP_NOTES=1 で飛ばせる。commit の題名が取れない (git が無い・host に無い commit) ときも飛ばして注意を出す
if [ -n "${IMAGE_COMMIT}" ] && [ -z "${HARMONY_SMOKE_SKIP_NOTES:-}" ]; then
  NOTES_SUBJECT="$(git log -1 --first-parent --format=%s "${IMAGE_COMMIT}" 2>/dev/null | sed -E 's/[[:space:]]*\(#[0-9]+\)//g' || true)"
  if [ -z "${NOTES_SUBJECT}" ] || [[ "${NOTES_SUBJECT}" =~ ^(Merge|Revert\ \"Merge) ]]; then
    echo "注意: commit ${IMAGE_COMMIT:0:7} の題名を host の git から取れない (または Merge commit) ため、リリースノートの確認を飛ばします" >&2
  else
    NOTES_HEAD="$("${ENGINE}" exec "${CONTAINER_NAME}" head -n 12 /app/docs/release-notes.md)" || {
      echo "image に /app/docs/release-notes.md がありません (Dockerfile の COPY を確認してください)" >&2
      exit 1
    }
    if ! grep -qF -- "${NOTES_SUBJECT}" <<<"${NOTES_HEAD}"; then
      echo "リリースノートの先頭に、image の commit の題名「${NOTES_SUBJECT}」がありません。--build-context での差し替えが効いていないかもしれません (build script を通さず作った image なら HARMONY_SMOKE_SKIP_NOTES=1)" >&2
      exit 1
    fi
  fi
fi

TEMPLATES="/app/ai-skills/generate-code/templates/devcontainer"
for combo in spring-boot-thymeleaf spring-boot-nextjs nestjs-thymeleaf nestjs-nextjs; do
  for f in .devcontainer/compose.yml .devcontainer/devcontainer.json .mcp.json .tmp/.gitignore Dockerfile README.snippet.md docker-compose.yml; do
    if ! "${ENGINE}" exec "${CONTAINER_NAME}" test -f "${TEMPLATES}/${combo}/${f}"; then
      echo "image に開発コンテナの雛形がありません: ${TEMPLATES}/${combo}/${f} (.dockerignore や COPY ai-skills を確認してください)" >&2
      exit 1
    fi
  done
done

echo "Smoke passed for ${IMAGE} on port ${PORT}"
