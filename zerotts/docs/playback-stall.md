# Player vBook kẹt vòng lặp — kết luận từ logcat

Triệu chứng: đọc được một lúc rồi im hẳn, app không báo lỗi, không tạm dừng TTS.
Cùng extension, cùng backend, cùng chương: **MuMuPlayer phát qua bình thường, điện
thoại thật thì dừng.**

Máy đo: Xiaomi `22071212AG`, Android 15, `com.vbook.android` (PID 32065).

## Phía backend: giao đủ, không lỗi

Phiên đo sạch, không có giả lập kết nối:

```
79 request   tất cả ext=v11   cùng một User-Agent Android 15
82 file phục vụ, tất cả .wav
mọi chặng POST / SSE / tải file đều HTTP 200
0 lỗi
```

Đoạn làm app dừng được yêu cầu lúc `10:36:58`, backend giao **0,48 s audio**, HTTP 200.
App còn tải tiếp **4 đoạn nữa** sau đó — đúng bằng `preload_size`, tức hàng tải trước
vẫn chạy trong khi hàng phát đã chết.

## Phía logcat: vòng lặp thử lại vô hạn

Backend ngừng phục vụ lúc `10:37:12`. Player vẫn quay vòng đều đặn tới `10:39:52`:

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

**Render 0.** Codec nhận buffer, gặp EOS ngay, không render được gì, rồi flush và thử
lại — mãi mãi.

## Rò rỉ MediaCodec

Đếm trong cùng phiên, chỉ tính PID của app:

```
CreateByType       : 30
setState RELEASING : 15
setState UNINITIALIZED : 15
```

**Tạo 30, giải phóng 15.** Số hiệu instance decoder trong phiên chạy từ `#118` tới
`#770`.

Số codec đồng thời mà một tiến trình được cấp là có hạn và **khác nhau theo thiết bị**.
Điều đó khớp với mọi quan sát:

- máy thật dừng, giả lập (codec phần mềm) không dừng
- dừng sau một **số đoạn** nhất định, nên cùng một chương đọc từ cùng chỗ thì luôn
  dừng ở cùng một dòng
- không có thông báo lỗi nào — cạn tài nguyên codec thường hỏng im lặng

## Không phải lỗi của extension

Đã thử và loại từng cái, mỗi lần đều xác nhận bằng số đo:

| Đã thử | Kết quả |
|--------|---------|
| WAV thô 48 kHz | dừng |
| MP3 48 kHz | dừng |
| MP3 24 kHz, luồng khung trần, khớp Google tới từng byte frame header | dừng |
| WAV PCM 24 kHz | dừng |
| Đệm mọi clip lên tối thiểu 2,0 giây | dừng |
| Bỏ thẻ ID3, header Xing/Info, độ trễ encoder | dừng |
| `execute()` không bao giờ trả `Response.error` | dừng |

Không một thuộc tính nào của file audio thay đổi được kết quả. Extension khớp đúng
contract trong `extension-api.md`: `type: "tts"`, hai script `voice` + `tts`,
`execute(text, voiceId)`, trả base64 trong `data`.

## Giảm nhẹ

Nếu nguyên nhân là cạn tài nguyên codec thì thứ quyết định là **tổng số clip**, không
phải nội dung. Ít clip hơn thì đi được xa hơn:

- **Chia nội dung = Theo đoạn** thay vì Theo câu
- **Độ dài tối đa** đặt cao (300–500) thay vì 120

Cả hai đều làm mỗi clip dài hơn và tổng số clip ít đi. Người dùng đã tự quan sát được
là chuyển sang chia theo đoạn thì đi xa hơn hẳn — khớp với cách giải thích này.

Đây là giảm nhẹ, không phải sửa. Chương đủ dài thì vẫn sẽ chạm ngưỡng.

## Nên báo cho tác giả vBook

Trích xuất log trong `logcat-evidence.txt` (không chứa nội dung truyện). Điểm cần nêu:

1. Player vào vòng lặp thử lại vô hạn thay vì bỏ qua clip hỏng hoặc báo lỗi
2. MediaCodec tạo ra nhiều gấp đôi số được giải phóng
3. Tái hiện được: engine TTS trả clip ngắn, chia nội dung theo câu, chương dài
4. Máy thật hỏng, giả lập không — hợp với giới hạn codec theo thiết bị
