# Harmony L2 production Dockerfile (#1472)
#
# 1 container で SPA / HTTP MCP / WebSocket を port 5179 から提供する。
# - frontend/dist は backend の HTTP fallback で静的配信する
# - HARMONY_HOME は machine-local state (recent-workspaces.json 等)
# - /data/workspaces はユーザー workspace の推奨 mount point

# ─── stage 1: build ─────────────────────────────────────────────────────────
FROM node:26-alpine AS build
WORKDIR /app

# npm を最新にそろえる (#1571)。package-lock.json を書いた npm と同じ系統で npm ci を走らせる。
# NPM_VERSION は scripts/build-harmony-image.sh が `npm view npm version` の結果を渡す。npm の新版が出たときだけこの層が作り直される
# (渡さなければ latest のままで、Docker の cache が効くと古い npm が残る。そのときは docker build --pull --no-cache)
ARG NPM_VERSION=latest
RUN npm install -g npm@${NPM_VERSION}

ARG VITE_HARMONY_SAME_PORT=1
ENV VITE_HARMONY_SAME_PORT=${VITE_HARMONY_SAME_PORT}

COPY package.json package-lock.json ./
# shared の prepare (tsc) が npm ci の中で走るので、npm ci より前に shared をソースごとコピーする。
# そのため shared のソースを変えると、npm ci の層が作り直しになる (ビルドが遅くなるが、挙動は正しい)
COPY shared ./shared
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN npm ci

# frontend / backend はリポジトリ直下の schemas を import するので build にも必要
COPY schemas ./schemas
COPY frontend ./frontend
COPY backend ./backend
# prune は --ignore-scripts を付ける。npm 12 は prune のあと shared の prepare (npm run build = tsc) を走らせるが、
# そのときには devDependencies の typescript が消えていて「tsc: not found」で落ちる (shared はすぐ上で build 済み。#1571)
RUN npm run build --workspace=@harmony/shared \
    && npm run build --workspace=frontend \
    && npm run build --workspace=backend \
    && npm prune --omit=dev --ignore-scripts

# ─── stage 2: runtime ───────────────────────────────────────────────────────
FROM node:26-alpine AS runtime
WORKDIR /app

# runtime では npm を使わない (起動は node だけ。backend も npm / npx を呼ばない) ので、同梱の npm を消す (#1571)。
# 最新の npm を入れ直すと、古い npm の層の上に新しい npm と npm のキャッシュが重なって image が大きくなるうえ、
# 使わない npm の脆弱性を image に残すことになる
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
ENV HARMONY_HOME=/home/node/.harmony
ENV HARMONY_STATIC_DIR=/app/frontend/dist
ENV DESIGNER_LOG_DIR=/app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY data/extensions ./data/extensions
# AI (MCP) が Resources / Prompts で読む資料 (docs/spec・docs/AI-INDEX.md・schemas・ai-skills)。.dockerignore の docs 除外から、これらだけ戻している
COPY schemas ./schemas
COPY docs/spec ./docs/spec
COPY docs/AI-INDEX.md docs/codemap.md docs/glossary.json ./docs/
COPY docs/decisions ./docs/decisions
# 画面「連携と運用 → 版と更新」のリリースノート (.dockerignore の docs 除外から戻している)
COPY docs/release-notes.md ./docs/release-notes.md
COPY examples/PATTERNS.md ./examples/PATTERNS.md
COPY ai-skills ./ai-skills

# 版の記録 (#1577): どの commit から作った image かを、OCI の label と /app/build-info.json に残す。
# 値は scripts/build-harmony-image.sh が渡す (渡さなければ空。空の項目は書かない)。変わりやすいので、cache を壊さないよう層の後ろの方に置く。
# 画面「連携と運用 → 版と更新」・designer__workspace_status・designer__check_harmony_update が build-info.json を読む
ARG HARMONY_BUILD_COMMIT=""
ARG HARMONY_BUILD_BRANCH=""
ARG HARMONY_BUILD_DIRTY=""
ARG HARMONY_BUILD_TIME=""
ARG HARMONY_BUILD_REPO=""
LABEL org.opencontainers.image.revision="${HARMONY_BUILD_COMMIT}" \
      org.opencontainers.image.created="${HARMONY_BUILD_TIME}" \
      org.opencontainers.image.source="${HARMONY_BUILD_REPO:+https://github.com/}${HARMONY_BUILD_REPO}"
RUN BUILD_COMMIT="${HARMONY_BUILD_COMMIT}" BUILD_BRANCH="${HARMONY_BUILD_BRANCH}" BUILD_DIRTY="${HARMONY_BUILD_DIRTY}" BUILD_TIME="${HARMONY_BUILD_TIME}" BUILD_REPO="${HARMONY_BUILD_REPO}" \
    node -e 'const e=process.env,o={};if(e.BUILD_COMMIT)o.commit=e.BUILD_COMMIT;if(e.BUILD_BRANCH)o.branch=e.BUILD_BRANCH;if(e.BUILD_DIRTY)o.dirty=e.BUILD_DIRTY==="true";if(e.BUILD_TIME)o.builtAt=e.BUILD_TIME;if(e.BUILD_REPO)o.repo=e.BUILD_REPO;require("fs").writeFileSync("/app/build-info.json",JSON.stringify(o,null,2)+"\n")'

# Docker は named volume 初期化時に image 内ディレクトリの owner/mode を引き継ぐ。
# VOLUME 宣言前に node 所有へ揃え、runtime 書き込みを EACCES にしない。
RUN mkdir -p /home/node/.harmony /data/workspaces logs \
    && chown -R node:node /home/node/.harmony /data/workspaces logs

VOLUME ["/home/node/.harmony", "/data/workspaces"]

EXPOSE 5179

USER node
CMD ["node", "backend/dist/index.js"]
