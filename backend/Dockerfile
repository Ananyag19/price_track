# Playwright's official image already contains Chromium and every system library it needs.
# The tag MUST match the "playwright" version pinned in package.json (1.49.1).
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV NODE_ENV=production
# Render injects PORT; the app reads it (see src/config.js)
EXPOSE 10000
CMD ["node", "src/server.js"]
