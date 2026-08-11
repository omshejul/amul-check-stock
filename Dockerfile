FROM node:22-bookworm-slim

# Install system dependencies required for curl and better-sqlite3
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    python3 \
    pkg-config \
    gosu \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.16.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# Install dependencies and build better-sqlite3 native bindings
# Use --ignore-scripts first, then explicitly rebuild better-sqlite3
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

