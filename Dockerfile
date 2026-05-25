FROM --platform=linux/amd64 node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./server/

EXPOSE 4000

CMD ["node", "server/index.mjs"]
