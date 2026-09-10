# RunwaySurfer proxy backend — immagine per la demo e lo sviluppo.
#
# Base Debian e NON Alpine: better-sqlite3 pubblica binari precompilati per
# Linux glibc e non per musl, quindi su Alpine `npm ci` ricade su node-gyp e
# l'immagine node:22-alpine non ha python3/make/g++. Con bookworm-slim non serve
# alcun toolchain.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Anche il lockfile, così `npm ci` installa le stesse versioni della CI.
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Default demo provider: nessun traffico verso Internet.
ENV AI_PROVIDER=mock
# Il TLS NON è configurato qui: l'immagine serve la demo mock in HTTP. In
# produzione il TLS è terminato da Node sull'host, senza reverse proxy (vedi
# deploy/runwaysurfer.service). Per usare comunque questa immagine con TLS:
# montare i PEM in sola lettura e passare TLS_CERT_PATH, TLS_KEY_PATH e PORT.
ENV PORT=8787
EXPOSE 8787
CMD ["node", "dist/index.js"]
