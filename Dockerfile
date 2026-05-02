FROM node:20-slim AS deps

LABEL org.opencontainers.image.source="https://github.com/buluma/messageforge"
LABEL org.opencontainers.image.description="MessageForge — Multi-device WhatsApp bot"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    webp \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:20-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    webp \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p session data logs \
    && chown -R node:node /app

USER node

EXPOSE 25680

CMD ["node", "messageforge.js"]
