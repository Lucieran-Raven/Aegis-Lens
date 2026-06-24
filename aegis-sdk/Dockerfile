# Aegis Lens v2.0 - TypeScript SDK Dockerfile
# Multi-stage build for optimized production image

# Stage 1: Build stage - Compile TypeScript and bundle with Rollup
FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY tsconfig.json rollup.config.cjs ./
COPY src ./src
# COPY proto ./proto # Proto directory is empty, skip for now

# Build TypeScript SDK
RUN npm run build

# Stage 2: Production stage - Minimal runtime image
FROM node:20-alpine AS production

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./
COPY --from=builder /build/package-lock.json ./

# Install only runtime dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S aegis && \
    adduser -u 1001 -S aegis -G aegis

USER aegis

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('SDK healthy')" || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port (if running as a service)
EXPOSE 3000

# Default command (SDK is typically consumed as a library, not a service)
CMD ["node", "-e", "console.log('Aegis Lens SDK v2.0 ready')"]

# Stage 3: Development stage - For local development
FROM node:20-alpine AS development

WORKDIR /app

# Copy all files for development
COPY package.json package-lock.json ./
COPY tsconfig.json rollup.config.cjs ./
COPY src ./src
# COPY proto ./proto # Proto directory is empty, skip for now

# Install all dependencies including dev dependencies
RUN npm install

# Install nodemon for hot reload
RUN npm install -g nodemon

# Set development environment
ENV NODE_ENV=development

# Watch mode for development
CMD ["npm", "run", "dev"]
