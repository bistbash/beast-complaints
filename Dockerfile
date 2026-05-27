FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --include=optional && npm install -g tsx@4

COPY --from=build /app/public/dist ./public/dist
COPY server.ts ./
COPY tsconfig.json ./
COPY config ./config
COPY routes ./routes
COPY middleware ./middleware
COPY services ./services
COPY lib ./lib

EXPOSE 3050
CMD ["tsx", "server.ts"]
