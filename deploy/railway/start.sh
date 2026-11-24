#!/bin/sh
# Arranque de nginx en Railway: arma la configuración con PORT y la API destino.
set -eu

PORT="${PORT:-8080}"
API_UPSTREAM="${API_UPSTREAM:-$(cat /etc/apexos/api-target)}"
API_UPSTREAM="${API_UPSTREAM%/}"

case "$API_UPSTREAM" in
  https://*) API_SCHEME=https ;;
  http://*) API_SCHEME=http ;;
  *) echo "API_UPSTREAM debe empezar por https:// o http:// (llegó: $API_UPSTREAM)" >&2; exit 1 ;;
esac
API_HOSTPORT="${API_UPSTREAM#*://}"
API_HOSTPORT="${API_HOSTPORT%%/*}"
API_HOST="${API_HOSTPORT%%:*}"

# DNS del contenedor: nginx vuelve a resolver la API cada minuto (las IP de Railway cambian).
RESOLVER="$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)"
case "$RESOLVER" in
  *:*) RESOLVER="[$RESOLVER]" ;;
esac

export PORT API_SCHEME API_HOSTPORT API_HOST RESOLVER
envsubst '${PORT} ${API_SCHEME} ${API_HOSTPORT} ${API_HOST} ${RESOLVER}' \
  < /etc/apexos/nginx.conf.template > /etc/nginx/conf.d/default.conf

echo "APEXOS Web Móvil en el puerto $PORT; /api -> $API_SCHEME://$API_HOSTPORT"
nginx -t
exec nginx -g 'daemon off;'
