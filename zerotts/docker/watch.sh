#!/bin/sh
# Lấy mẫu bộ đếm request của cloudflared, in ra khi có thay đổi.
PREV=""
for i in $(seq 1 180); do
  M=$(docker run --rm --network docker_default curlimages/curl:latest -s http://zerotts-tunnel:20241/metrics 2>/dev/null \
      | grep -E "^cloudflared_tunnel_(total_requests|request_errors)" | tr '\n' ' ')
  if [ "$M" != "$PREV" ]; then
    echo "[$(date +%H:%M:%S)] $M"
    PREV="$M"
  fi
  sleep 5
done
