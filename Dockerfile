FROM node:20-alpine AS build
WORKDIR /app

# The frontend build doesn't need Chromium; skip Puppeteer's (glibc) download.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Puppeteer's bundled Chromium is built for glibc and will NOT run on Alpine
# (musl). Install the system Chromium instead, plus fonts — including Hebrew —
# so the closing-letter PDF renders correctly. Point Puppeteer at it and skip
# the bundled download.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto-hebrew
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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
