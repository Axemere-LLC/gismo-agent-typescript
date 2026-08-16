# Builds the stub agent in src/main.ts. Fork this repo and swap the
# strategy main.ts constructs (see src/agent/strategy.ts) before deploying
# your own agent — this Dockerfile's build/runtime structure does not need
# to change for that.
FROM node:22-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS builder
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /src/dist ./dist
USER node
ENTRYPOINT ["node", "dist/src/main.js"]
