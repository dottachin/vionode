# Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Ignore peer dependency conflicts to allow tailwind-variants 2.x with rizzui
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# Serve
FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
