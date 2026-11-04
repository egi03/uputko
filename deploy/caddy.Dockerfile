# Premium web app: build the React app, serve it with Caddy (HTTPS) in front of the backend.
FROM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
# Same origin as the API behind Caddy, so no base URL. The agent comes from the backend's
# session token (ELEVENLABS_AGENT_ID), never from the build.
ARG VITE_PUBLIC_URL=""
ENV VITE_API_BASE_URL="" VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
