FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache vips

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=7100
ENV HOST=0.0.0.0

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY dist ./dist
RUN chmod +x dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/storage-server

VOLUME ["/data"]
EXPOSE 7100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:7100/health || exit 1

CMD ["node", "dist/index.js"]

