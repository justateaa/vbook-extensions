#!/bin/sh
# Quét (số worker × số luồng) theo THÔNG LƯỢNG GỘP, không theo RTF từng request.
#
# RTF của một request lẻ là chỉ số sai để tối ưu ở đây: chạy 2 job song song làm
# mỗi job chậm đi, nhưng tổng số giây audio sinh ra trên mỗi giây đồng hồ lại
# tăng. App tải trước nhiều câu nên cái nó cần là thông lượng gộp.
#
# Aggregate RTF = (thời gian đồng hồ) / (tổng số giây audio sinh ra).
# Dưới 1,0 nghĩa là hàng đệm lớn dần -> không còn khoảng trống.
#
#   sh test/throughput.sh "1x4 2x2 3x2 4x2"
set -e
cd "$(dirname "$0")/../docker"
COMBOS="${1:-1x4 2x2 3x2 4x2}"
TEXT='Trời vừa hửng sáng, hắn đã thu xếp hành lý rồi lặng lẽ rời khỏi thôn, không từ biệt một ai.'
printf '%s' "{\"text\":\"$TEXT\",\"voice\":\"giahuy\"}" > /tmp/tp_req.json

one() {
  ID=$(curl -s -X POST http://127.0.0.1:7860/gradio_api/call/v2/synthesize \
       -H "Content-Type: application/json" --data-binary @/tmp/tp_req.json \
       | sed -n 's/.*"event_id":"\([^"]*\)".*/\1/p')
  curl -sN --max-time 300 "http://127.0.0.1:7860/gradio_api/call/synthesize/$ID" \
    | grep '^data:' | tail -1 | sed -n 's/.*[^0-9.]\([0-9.]*\)s of audio.*/\1/p'
}

echo "worker×luồng | đồng hồ | audio sinh ra | RTF gộp | "
echo "-------------+---------+---------------+---------+------------------"

for C in $COMBOS; do
  W=$(echo "$C" | cut -dx -f1)
  T=$(echo "$C" | cut -dx -f2)
  sed -i "s/ZEROTTS_THREADS: \"[0-9]*\"/ZEROTTS_THREADS: \"$T\"/" docker-compose.yml
  sed -i "s/ZEROTTS_CONCURRENCY: \"[0-9]*\"/ZEROTTS_CONCURRENCY: \"$W\"/" docker-compose.yml
  docker compose up -d zerotts >/dev/null 2>&1
  i=0
  while [ $i -lt 40 ]; do
    curl -sf --max-time 5 http://127.0.0.1:7860/gradio_api/info -o /dev/null 2>/dev/null && break
    i=$((i+1)); sleep 3
  done

  # Một vòng: bắn đúng W request song song, đó là mức tải worker được cấp.
  T0=$(date +%s%N)
  rm -f /tmp/tp_out.*
  k=0
  while [ $k -lt "$W" ]; do
    one > "/tmp/tp_out.$k" &
    k=$((k+1))
  done
  wait
  T1=$(date +%s%N)

  WALL=$(awk "BEGIN{printf \"%.1f\", ($T1-$T0)/1000000000}")
  AUDIO=$(cat /tmp/tp_out.* 2>/dev/null | awk '{s+=$1} END{printf "%.1f", s}')
  RTF=$(awk "BEGIN{if($AUDIO>0) printf \"%.2f\", $WALL/$AUDIO; else print \"?\"}")
  VERDICT=$(awk "BEGIN{if($AUDIO>0 && $WALL/$AUDIO<1) print \"kịp - đệm lớn dần\"; else print \"chậm hơn nghe\"}")
  printf '%12s |%8ss |%13ss |%8s | %s\n' "$C" "$WALL" "$AUDIO" "$RTF" "$VERDICT"
done

rm -f /tmp/tp_req.json /tmp/tp_out.*
echo
echo "Chọn mức RTF gộp thấp nhất. Nhớ bật 'Tải trước song song' trong app,"
echo "không thì app chỉ gửi từng câu một và số worker dư ra không dùng tới."
