FROM node:22-bookworm-slim

# Install system dependencies required for Puppeteer and better-sqlite3
# Use system Chromium for automatic platform-agnostic architecture selection
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    python3 \
    pkg-config \
    su-exec \
    chromium \
    libasound2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libxrandr2 \
    libatk1.0-0 \
    libpangocairo-1.0-0 \
    libcups2 \
    libxss1 \
    libgbm1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_HEADLESS=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.16.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# Install dependencies and build better-sqlite3 native bindings
# Use --ignore-scripts first, then explicitly rebuild better-sqlite3
# Puppeteer will use system Chromium (already installed above)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npm run install --build-from-source

COPY . .

# Copy and setup entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create data directory and set correct permissions for node user
RUN mkdir -p /app/data && \
    chown -R node:node /app

EXPOSE 3000

VOLUME ["/app/data"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "index.js"]


