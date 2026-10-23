# Angular dashboard served by nginx; /api and /ws are proxied to the API service (API_UPSTREAM).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV API_UPSTREAM=api:3000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
