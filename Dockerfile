FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS test
COPY . .
RUN npm test && npm run check && npm run build

FROM nginx:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="mlr-web" \
      org.opencontainers.image.description="Web-based MLR-inspired sampler for monome classic over USB"
COPY --from=test /app/index.html /usr/share/nginx/html/index.html
COPY --from=test /app/css /usr/share/nginx/html/css
COPY --from=test /app/js /usr/share/nginx/html/js
COPY --from=test /app/docs /usr/share/nginx/html/docs
COPY --from=test /app/README.md /usr/share/nginx/html/README.md
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
