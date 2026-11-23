# Build from the repo root:  docker build -f server/Dockerfile -t go-edge .
FROM node:22-slim AS build
WORKDIR /app
RUN npm i -g esbuild@0.28.2
COPY convex/lib ./convex/lib
COPY edge ./edge
COPY server ./server
RUN esbuild server/node.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/server.mjs

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /app/dist/server.mjs ./server.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["server.mjs"]
