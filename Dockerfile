FROM node:20-slim

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
RUN npm install --production --ignore-scripts

COPY . .

RUN mkdir -p session data

EXPOSE 25680

CMD ["node", "messageforge.js"]
