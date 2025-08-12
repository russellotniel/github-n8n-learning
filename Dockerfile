FROM node:22-alpine AS base

# 1. Install dependencies and build only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy the package manager lock files and pre-installed node_modules
# COPY package*.json ./
# COPY node_modules ./node_modules

# Install dependencies based on the preferred package manager
COPY . .
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Build the source code
# This will do the trick, use the corresponding env file for each environment.
RUN npm run build

# This is to make sure public directory is exist
RUN if [ -d /app/public ]; then \
        # If directory exists, continue with the build process
        echo "Directory exists in the builder stage."; \
    else \
        # If directory doesn't exist, create an empty directory to avoid COPY errors
        echo "Directory doesn't exist in the builder stage. Creating an empty directory."; \
        mkdir -p /app/public; \
    fi

# 3. Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

COPY --from=deps /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=deps --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=deps --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

CMD HOSTNAME=0.0.0.0 node server.js
