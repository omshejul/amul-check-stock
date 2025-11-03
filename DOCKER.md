# Docker Setup Guide

## Platform-Agnostic Architecture

This Docker setup is **fully platform-agnostic** and works seamlessly across:

- ✅ **ARM64** (Apple Silicon M1/M2/M3)
- ✅ **x86_64/AMD64** (Intel/AMD processors)

## How It Works

### Native Binary Compilation

The Dockerfile compiles native Node.js modules (like `better-sqlite3`) during the build process, ensuring they match the target architecture:

```dockerfile
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npm run install --build-from-source
```

### System Chromium

Instead of downloading architecture-specific Chromium binaries, we use the system package manager which automatically installs the correct version:

```dockerfile
RUN apt-get install -y chromium ...
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

This approach:

- ✅ Automatically selects the right architecture
- ✅ Reduces image size
- ✅ Improves security with system updates
- ✅ Works reliably on both ARM64 and AMD64

## Quick Start

### Docker Compose (Recommended)

```bash
# Start the service
docker compose up -d

# View logs
docker compose logs -f

# Stop the service
docker compose down
```

### Docker Build & Run

```bash
# Build for your current architecture
docker build -t amul-check-stock .

# Run the container
docker run \
  --name amul-check-stock \
  --rm \
  --env-file .env \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  amul-check-stock
```

## Multi-Platform Builds

For advanced use cases (publishing to registries, deploying to multiple server types):

### Setup Buildx (One-Time)

```bash
docker buildx create --use --name multiplatform
```

### Build for Multiple Architectures

```bash
# Build and push to Docker Hub/Registry
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-username/amul-check-stock:latest \
  --push .
```

### Load Locally (Single Architecture)

If you want to test locally without pushing:

```bash
# Build for your current platform and load
docker buildx build \
  --platform linux/$(uname -m) \
  -t amul-check-stock:latest \
  --load .
```

## Architecture Details

### Dockerfile Strategy

1. **Base Image**: `node:22-bookworm-slim` - Debian-based, multi-arch support
2. **Build Dependencies**: Installed during build (build-essential, python3, pkg-config)
3. **Native Compilation**: better-sqlite3 compiled from source
4. **System Chromium**: Installed via apt for automatic architecture selection
5. **Production Runtime**: Runs as non-root `node` user

### Environment Variables

| Variable                           | Default             | Description                        |
| ---------------------------------- | ------------------- | ---------------------------------- |
| `NODE_ENV`                         | `production`        | Node.js environment                |
| `PUPPETEER_HEADLESS`               | `true`              | Run Chromium headless              |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true`              | Skip Puppeteer's Chromium download |
| `PUPPETEER_EXECUTABLE_PATH`        | `/usr/bin/chromium` | Use system Chromium                |

## Troubleshooting

### Build Issues

**Problem**: Native module build fails  
**Solution**: Ensure build tools are installed in the Dockerfile (build-essential, python3, pkg-config)

**Problem**: Chromium not found  
**Solution**: Verify `chromium` package is installed and `PUPPETEER_EXECUTABLE_PATH` is set correctly

### Runtime Issues

**Problem**: Permission denied on `/app/data`  
**Solution**: Ensure the mounted volume has correct permissions, or the container runs as the `node` user

**Problem**: Health check failing  
**Solution**: Check logs with `docker compose logs` - the app exposes `/health` endpoint on port 3000

## Best Practices

1. **Use Docker Compose** for local development - simplifies configuration
2. **Mount data directory** as a volume to persist SQLite database
3. **Set proper .env file** with required API keys before starting
4. **Monitor logs** regularly with `docker compose logs -f`
5. **Keep images updated** by rebuilding periodically for security patches

## Security Considerations

- ✅ Runs as non-root user (`node`)
- ✅ Uses latest Node.js LTS (22)
- ✅ System package updates via `apt-get upgrade`
- ✅ Minimal image size (bookworm-slim base)
- ✅ No unnecessary packages installed

## Image Size Optimization

The current setup balances functionality and size:

- System Chromium (~150MB) is necessary for Puppeteer
- Native compilation tools are kept in build stage
- Debian bookworm-slim reduces base image size
- Multi-stage builds could further reduce size if needed

## Next Steps

- Consider multi-stage builds to separate build and runtime
- Add CI/CD pipeline for automated multi-platform builds
- Publish images to Docker Hub or GitHub Container Registry
- Add docker-compose.prod.yml for production deployments
