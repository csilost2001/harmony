FROM node:26-alpine AS builder
# npm を最新にそろえる (Harmony の package-lock.json と同じ系統。古い npm だと lock の libc の欄が消える)
RUN npm install -g npm@latest
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN mkdir -p views prisma
RUN npx prisma generate 2>/dev/null || true
RUN npm run build

FROM node:26-alpine
WORKDIR /app
COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/views ./views
COPY --from=builder /build/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/main"]
