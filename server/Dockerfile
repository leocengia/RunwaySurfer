# RunwaySurfer proxy backend — container per il deploy sul server aziendale.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# Default demo provider: nessun traffico verso Internet.
ENV AI_PROVIDER=mock
ENV PORT=8787
EXPOSE 8787
CMD ["node", "dist/index.js"]
