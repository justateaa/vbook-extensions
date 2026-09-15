# vBook player kẹt vòng lặp vô hạn giữa chương

Triệu chứng: đọc được một lúc rồi im hẳn. App không báo lỗi, không tạm dừng, không
bỏ qua. **Bấm skip qua đúng đoạn đó thì mọi đoạn sau phát bình thường.**

Cùng extension, cùng backend, cùng chương: **MuMuPlayer phát trọn, điện thoại thật
thì dừng.** (Cả hai đều chạy ZeroTTS; chưa thử google-tts trên máy thật.) Máy đo: Xiaomi `22071212AG`, Android 15, `com.vbook.android` (PID 32065).

## Phía backend: giao đủ, không lỗi

Phiên đo sạch, xác minh bằng header `X-ZeroTTS-Ext` và User-Agent của máy thật:

```
mọi chặng POST / SSE / tải file đều HTTP 200
0 lỗi, 0 timeout, 0 request bị bỏ
```

Đoạn làm app dừng vẫn được giao HTTP 200 như mọi đoạn khác. App còn tải tiếp
`preload_size` đoạn nữa sau đó — hàng tải trước vẫn chạy trong khi hàng phát đã chết.
Rồi im lặng hoàn toàn cho tới khi người dùng bấm skip.

## Phía logcat: vòng lặp thử lại vô hạn

Backend ngừng phục vụ lúc `10:37:12`. Player vẫn quay vòng đều tới `10:39:52`:

```
10:39:38.930  reached audio EOS
10:39:40.210  reached audio EOS
10:39:41.447  reached audio EOS
...
```

**Hơn 2,5 phút, 85+ vòng, mỗi vòng cách nhau ~1,24 giây, không có dữ liệu mới nào.**

Mỗi vòng giống hệt nhau:

```
queueInputBuffer: index: 0 pts: 0
queueInputBuffer: index: 1 pts: 0
[c2.android.raw.decoder] input EOS
[c2.android.raw.decoder] buffers after EOS ignored (0 us)
performDecoderFlush -> flushing audio -> decoder audio flush completed
```

Thống kê do chính MediaCodec in ra:

```
[audio-debug-dec] ClientName: com.vbook.android ComponentName: c2.android.raw.decoder
[audio-debug-dec] Render: 0, Drop: 8, DQoutput: 0 success out of 0 tries
```

**Render 0.** Codec nhận buffer, gặp EOS ngay, không render được gì, flush, thử lại —
mãi mãi. Đây là hành vi cần sửa dù nguyên nhân kích hoạt là gì: **player phải bỏ qua
hoặc báo lỗi, không được quay vòng câm 2,5 phút.**

## Nơi lỗi rơi vào: clip audio rất ngắn

Đo trên chính chiếc máy đó, lọc theo User-Agent Android, tính cả preload:

```
6,64s  'Nếu như chỉ có mỗi Yoo Daon với tôi thôi thì...'   phát bình thường
1,44s  'Một trong ba trường hợp đấy thôi.'                 phát bình thường
0,48s  'Ầm'                                                DỪNG Ở ĐÂY
2,88s  'Một viên gạch suýt chút nữa đã rơi trúng đầu...'   preload, không bao giờ phát
0,96s  '...Ah, cảm ơn'                                     preload, không bao giờ phát
```

Hai request cuối là hàng tải trước (`preload_size = 2`), không phải đoạn đang phát.
Trừ ngược ra thì đoạn làm app đứng là **`Ầm` — clip 0,48 giây, ngắn nhất cả phiên**.
Sau đó app không xin thêm đoạn nào nữa cho tới khi người dùng bấm skip.

Khớp với một quan sát độc lập từ phiên trước: **dừng ở clip 0,5–1,0 s, clip 1,4 s vẫn
chạy.**

Các đoạn khác đã tái hiện được: `-Ầm!`, `Chính là nó!`, `"Con người...?"` — đều là
dòng rất ngắn.

### Đoạn chỉ toàn dấu câu không liên quan

App **đã tự lọc dấu câu trước khi gọi extension** (đúng các luật trong phần cài đặt
"Thay thế từ"): `-Ầm!` tới backend thành `text='Ầm'`. Đếm trên phiên đo:

```
10 request từ điện thoại — 0 đoạn nào không có chữ
```

## Đã loại trừ: mọi thuộc tính của file audio

Mỗi dòng dưới đây là một lần đo riêng trên đúng chiếc máy đó:

| Đã thử | Kết quả |
|--------|---------|
| WAV thô 48 kHz | dừng |
| MP3 48 kHz | dừng |
| MP3 24 kHz, luồng khung trần, khớp Google tới từng byte frame header | dừng |
| WAV PCM 24 kHz | dừng |
| Đệm mọi clip lên tối thiểu 2,0 giây | **chưa kết luận được — xem ghi chú dưới** |
| Bỏ thẻ ID3, header Xing/Info, độ trễ encoder | dừng |
| `execute()` không bao giờ trả `Response.error` | dừng |
| Khoảng lặng có dither -64 dBFS thay vì zero tuyệt đối | không liên quan — máy không đi vào nhánh này |
| Ép mỗi response mất tối thiểu 0,8 s (giãn nhịp) | dừng |

Ghi chú về dòng "đệm clip": hai lần thử đều không đáng tin. Lần đầu chạy trước khi
có header `X-ZeroTTS-Ext`, nên không chứng minh được máy đang chạy đúng bản extension.
Lần sau chạy lẫn với traffic test cục bộ trên cùng container. **Đang đo lại.**

**Giả thuyết cạn tài nguyên MediaCodec đã bị bác.** Phiên đo có đếm `CreateByType: 30`
so với `RELEASING: 15` — tạo gấp đôi số giải phóng, vẫn là rò rỉ đáng báo. Nhưng nó
không phải nguyên nhân của việc dừng: nếu cạn codec thì các đoạn **sau** cũng phải
chết theo, mà thực tế bấm skip một cái là phát tiếp trơn tru.

## Audio đã bị loại trừ hoàn toàn

Backend được cho trả **đúng byte audio của Google TTS** cho chính dòng đang lỗi
(`Ầm`, 5952 byte), xác minh trùng khớp từng byte, và xác minh `[OVR]` có bắn cho
đúng request mang User-Agent Android:

```
04:49:01  ext=v14  'Ầm'  <<< CLIP GOOGLE   -> vẫn đứng
```

Cùng một dãy byte. Đi qua extension này thì máy không phát được. **Nội dung file
audio không phải nguyên nhân.**

Điều còn lại phân biệt được: chỗ đứng luôn ở **cùng một chỉ số đoạn**, bất kể văn
bản, bất kể byte audio, bất kể độ dài, format hay sample rate. Đó là chữ ký của một
**bộ đếm**, không phải của nội dung — khớp với con số 30 codec tạo ra so với 15 được
giải phóng.

## So sánh với Google TTS

> **CHƯA KIỂM CHỨNG.** Chưa từng phát đúng chương này bằng chính extension
> google-tts trên chính chiếc máy này. Phép A/B đó đang chờ chạy, và nó quyết định
> toàn bộ phần dưới: nếu google-tts cũng đứng ở cùng đoạn thì đây là lỗi app độc
> lập với engine, và mọi quy kết về audio bên dưới đều vô nghĩa.

Chạy `execute()` của extension google-tts trên cùng các input rồi giải mã:

```
'-'    0,29s  peak=0,00018     '.'    0,82s  peak=0,54467
'…'    0,29s  peak=0,00018     '...'  1,51s  peak=0,48169
                               '?'    1,08s  peak=0,47502
```

Google **đọc thành tiếng** các dấu `.` `...` `?` (peak ≈ 0,48 là giọng thật), chỉ trả
clip gần câm cho `-` và `…`.

## Extension khớp đúng contract

`type: "tts"`, hai script `voice` + `tts`, `execute(text, voiceId)`, trả base64 trong
`data` qua `Response.success`, không bao giờ trả `Response.error`.

## Đề nghị với tác giả vBook

1. **Player vào vòng lặp thử lại vô hạn thay vì bỏ qua clip hoặc báo lỗi.** Đây là lỗi
   độc lập với engine TTS: dừng câm 2,5 phút mà giao diện không hề báo gì.
2. **MediaCodec tạo ra nhiều gấp đôi số được giải phóng** (30 vs 15 trong một phiên).
3. Tái hiện: engine TTS trả một clip khoảng 0,5 giây (dòng thoại/tượng thanh rất ngắn),
   chia nội dung Theo câu. Máy thật hỏng, giả lập không hỏng.
4. Trích log trong `logcat-evidence.txt` (không chứa nội dung truyện).
