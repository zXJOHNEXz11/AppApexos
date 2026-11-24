# APEXOS Web Móvil — imagen para Railway (o cualquier hosting con Docker).
#
# 1) Compila la PWA con el ambiente elegido (qa | production): API y Supabase del
#    mismo ambiente, igual que la app Flutter.
# 2) nginx sirve la app y reenvía /api/* a la API de APEXOS en el MISMO dominio
#    (sin CORS). Railway pone el HTTPS delante y la variable PORT.
#
# Variables (Railway → servicio → Variables):
#   APEXOS_MODE        qa (por defecto) | production          [se usa al compilar]
#   API_UPSTREAM       URL de la API. Por defecto la de .env.<modo>  [en ejecución]
#   VITE_API_BASE_URL  Opcional: llamar la API directo (exige CORS en la API)  [al compilar]

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG APEXOS_MODE=qa
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN case "$APEXOS_MODE" in \
      production) npm run build ;; \
      qa) npm run build:qa ;; \
      *) echo "APEXOS_MODE debe ser qa o production (llegó: $APEXOS_MODE)" >&2; exit 1 ;; \
    esac \
 && grep -E '^APEXOS_API_TARGET=' ".env.$APEXOS_MODE" | cut -d= -f2- | tr -d '\r' > /app/api-target \
 && test -s /app/api-target \
 && test -f dist/models/human/blazeface.json

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/api-target /etc/apexos/api-target
COPY deploy/railway/nginx.conf.template /etc/apexos/nginx.conf.template
COPY deploy/railway/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/railway/start.sh /start.sh
RUN sed -i 's/\r$//' /start.sh && chmod +x /start.sh && rm -f /etc/nginx/conf.d/default.conf
ENV PORT=8080
EXPOSE 8080
CMD ["/start.sh"]
