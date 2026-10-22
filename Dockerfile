# Stage 1: Build TypeScript
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Stage 2: Ultra-compact production runtime (~65% smaller)
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=7100 \
    HOST=0.0.0.0

# Install production dependencies only and purge npm cache
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm -rf /root/.npm /root/.cache /tmp/*

# Copy built distribution from builder
COPY --from=builder /app/dist ./dist
RUN chmod +x dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/storage-server

VOLUME ["/data"]
EXPOSE 7100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:7100/health || exit 1

CMD ["node", "dist/index.js"]


