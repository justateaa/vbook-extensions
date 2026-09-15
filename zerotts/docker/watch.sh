#!/bin/sh
# Lấy mẫu bộ đếm request của cloudflared mỗi 5s, in ra mỗi khi đổi.
# Dùng để xem app còn gọi backend hay đã bỏ cuộc.
PREV=""
for i in $(seq 1 240); do
  M=$(docker run --rm --network docker_default curlimages/curl:latest -s \
      http://zerotts-tunnel:20241/metrics 2>/dev/null \
      | sed -n 's/^cloudflared_tunnel_total_requests \(.*\)/\1/p')
  E=$(docker run --rm --network docker_default curlimages/curl:latest -s \
      http://zerotts-tunnel:20241/metrics 2>/dev/null \
      | sed -n 's/^cloudflared_tunnel_request_errors \(.*\)/\1/p')
  if [ "$M" != "$PREV" ]; then
    echo "[$(date +%H:%M:%S)] request=$M  lỗi=$E"
    PREV="$M"
  fi
  sleep 5
done
echo "[$(date +%H:%M:%S)] hết giờ theo dõi"
