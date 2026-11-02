# SnapEX Pay MCP server (stdio) — for Glama, Docker MCP and other catalogs that run servers in a container.
# docker build -t snapex-pay-mcp . && docker run -i --rm -e SNAPEX_API_KEY=smk_… snapex-pay-mcp
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
LABEL io.modelcontextprotocol.server.name="pro.snapex/pay"
LABEL org.opencontainers.image.source="https://github.com/snapexpay/snapex-pay-mcp" org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production SNAPEX_BASE_URL=https://pay.snapex.pro SNAPEX_NO_SAVE=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
