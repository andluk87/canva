FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=cloud_ca,required=false \
    if [ -f /run/secrets/cloud_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cloud_ca; fi; \
    npm ping --fetch-retries=0 --fetch-timeout=15000 && \
    npm ci --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY shared ./shared
RUN npm run build && npm prune --offline --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8192 DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8192
VOLUME ["/app/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:8192/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
