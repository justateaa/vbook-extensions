#!/bin/sh
# Lấy mẫu số request ĐỒNG THỜI mỗi giây, ghi lại đỉnh.
# Đỉnh > 1 = app có gửi song song -> 3 worker của backend dùng được.
# Đỉnh = 1 suốt = app gửi tuần tự -> worker dư vô dụng, phải xoay cách khác.
MAX=0
PREV=""
for i in $(seq 1 600); do
  M=$(docker run --rm --network docker_default curlimages/curl:latest -s \
      http://zerotts-tunnel:20241/metrics 2>/dev/null \
      | sed -n 's/^cloudflared_tunnel_concurrent_requests_per_tunnel \(.*\)/\1/p')
  T=$(docker run --rm --network docker_default curlimages/curl:latest -s \
      http://zerotts-tunnel:20241/metrics 2>/dev/null \
      | sed -n 's/^cloudflared_tunnel_total_requests \(.*\)/\1/p')
  [ -z "$M" ] && M=0
  if [ "$M" -gt "$MAX" ] 2>/dev/null; then MAX=$M; fi
  LINE="conc=$M đỉnh=$MAX tổng=$T"
  if [ "$LINE" != "$PREV" ]; then
    echo "[$(date +%H:%M:%S)] $LINE"
    PREV="$LINE"
  fi
done
