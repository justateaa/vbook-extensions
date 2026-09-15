#!/bin/sh
# Quét số luồng ONNX, đo RTF do chính engine báo (loại nhiễu mạng).
# Nhiều luồng hơn không phải lúc nào cũng nhanh hơn: ONNX tranh chấp lõi, và
# Docker Desktop chạy Linux trong VM nên số lõi thấy được không phản ánh
# năng lực thật. Chạy: sh test/sweep.sh "2 3 4 6"
set -e
cd "$(dirname "$0")/../docker"
LEVELS="${1:-2 3 4 6}"
TEXT='Trời vừa hửng sáng, hắn đã thu xếp hành lý rồi lặng lẽ rời khỏi thôn, không từ biệt một ai trong nhà.'

printf '%s' "{\"text\":\"$TEXT\",\"voice\":\"giahuy\"}" > /tmp/sweep_req.json

echo "luồng |  lần 1  |  lần 2  |  lần 3  | engine báo"
echo "------+---------+---------+---------+------------"

for T in $LEVELS; do
  sed -i "s/ZEROTTS_THREADS: \"[0-9]*\"/ZEROTTS_THREADS: \"$T\"/" docker-compose.yml
  docker compose up -d zerotts >/dev/null 2>&1
  # Đợi cổng mở lại (weights đã cache nên nhanh).
  i=0
  while [ $i -lt 40 ]; do
    curl -sf --max-time 5 http://127.0.0.1:7860/gradio_api/info -o /dev/null 2>/dev/null && break
    i=$((i+1)); sleep 3
  done

  ROW=""
  LAST=""
  for R in 1 2 3; do
    ID=$(curl -s -X POST http://127.0.0.1:7860/gradio_api/call/v2/synthesize \
         -H "Content-Type: application/json" --data-binary @/tmp/sweep_req.json \
         | sed -n 's/.*"event_id":"\([^"]*\)".*/\1/p')
    OUT=$(curl -sN --max-time 300 "http://127.0.0.1:7860/gradio_api/call/synthesize/$ID" \
          | grep '^data:' | tail -1)
    # "... 6.2s of audio in 6.4s (RTF 1.03x on 4 CPU threads)"
    RTF=$(echo "$OUT" | sed -n 's/.*RTF \([0-9.]*\)x.*/\1/p')
    [ -z "$RTF" ] && RTF="?"
    ROW="$ROW$(printf '%8s |' "$RTF")"
    LAST=$(echo "$OUT" | sed -n 's/.*· \([0-9.]*s of audio in [0-9.]*s\).*/\1/p')
  done
  printf '%5s |%s %s\n' "$T" "$ROW" "$LAST"
done

rm -f /tmp/sweep_req.json
echo
echo "Chọn số luồng có RTF thấp nhất, rồi đặt lại ZEROTTS_THREADS trong docker-compose.yml."
