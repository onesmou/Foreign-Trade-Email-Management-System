FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3011 HOSTNAME=0.0.0.0 DATA_DIR=/app/data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/backup.mjs ./scripts/backup.mjs
COPY --from=build --chown=node:node /app/scripts/restore.mjs ./scripts/restore.mjs
COPY --from=build --chown=node:node /app/scripts/init-env.mjs ./scripts/init-env.mjs
COPY --from=build --chown=node:node /app/LICENSE ./LICENSE
COPY --from=build --chown=node:node /app/lib/backup-core.ts ./lib/backup-core.ts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3011
CMD ["node", "server.js"]
