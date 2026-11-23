# MediStock API (Express + Mongoose). Build from the repo root with `docker compose build backend`,
# or `docker build -t medistock-backend server`.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first, so source edits don't reinstall them
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Run as the image's unprivileged user; it needs to write logs/ and uploads/
RUN mkdir -p logs uploads && chown -R node:node logs uploads
USER node

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
