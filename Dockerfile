FROM node:22-alpine AS deps
WORKDIR /app

COPY package-lock.json package.json ./
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app

COPY package-lock.json package.json ./
RUN npm ci --ignore-scripts --omit=dev

FROM node:22-alpine AS production
WORKDIR /app

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    apk --no-cache add dumb-init

COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=prod-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

USER appuser

ENV HOST=0.0.0.0
ENV PORT=3021
ENV NODE_ENV=production

EXPOSE 3021

ENTRYPOINT ["dumb-init", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3021/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
