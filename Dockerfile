# -----------------------------------------------------------------------------
# Imagen de produccion del bot (build multi-stage, runtime minimo).
# Construir:  docker build -t bot-gastos .
# Ejecutar:   docker run --env-file .env bot-gastos
# -----------------------------------------------------------------------------

# ---- Etapa de build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Etapa de runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]