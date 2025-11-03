#!/bin/sh
set -e

# Fix permissions for the data directory if it exists
if [ -d "/app/data" ]; then
    echo "Fixing permissions for /app/data..."
    chown -R node:node /app/data
fi

# Switch to node user and execute the main command
exec su-exec node "$@"

