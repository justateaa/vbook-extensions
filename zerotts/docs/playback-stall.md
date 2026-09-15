# vBook đứng phát giữa chương, độc lập với engine TTS

Triệu chứng: đọc được một lúc rồi im hẳn. App không báo lỗi, không tạm dừng, không
bỏ qua. **Bấm skip qua đúng đoạn đó thì mọi đoạn sau phát bình thường.**

Máy: Xiaomi `22071212AG`, Android 15, `com.vbook.android` (PID 32065).

## Bằng chứng quyết định: hai engine không liên quan, cùng một chỗ đứng

Cùng chương, cùng máy, cùng vị trí dừng:

| Engine TTS | Nguồn audio | Kết quả |
|---|---|---|
| ZeroTTS (extension này) | backend tự host qua Cloudflare tunnel | **đứng tại `-Ầm!`** |
| Google TTS (extension của vBook) | translate.google.com | **đứng tại `-Ầm!`** |

Hai extension không dùng chung một dòng code, một máy chủ, hay một định dạng audio
nào. **Lỗi không nằm ở engine TTS.**

## Audio cũng đã bị loại trừ, riêng biệt

Trước phép A/B trên, backend được cho trả **đúng byte audio của Google TTS** cho
chính dòng đang lỗi — xác minh trùng khớp từng byte, và xác minh dòng log `[OVR]`
bắn đúng vào request mang User-Agent Android:

```
04:49:01  ext=v14  'Ầm'  <<< CLIP GOOGLE (5952 byte)   -> vẫn đứng
```

Cùng một dãy byte máy đó phát được khi đến từ extension Google, nhưng không phát
được khi đến từ extension này. Đã thử và loại từng thuộc tính, mỗi lần đều xác nhận
bằng số đo trên chính máy đó:

| Đã thử | Kết quả |
|--------|---------|
| WAV thô 48 kHz | đứng |
| MP3 48 kHz | đứng |
| MP3 24 kHz, luồng khung trần, khớp Google tới từng byte frame header | đứng |
| WAV PCM 24 kHz | đứng |
| Đệm mọi clip lên tối thiểu 2,0 giây (`Ầm`: 0,48s → 2,00s) | đứng |
| Bỏ thẻ ID3, header Xing/Info, độ trễ encoder | đứng |
| `execute()` không bao giờ trả `Response.error` | đứng |
| Ép mỗi response mất tối thiểu 0,8 s | đứng |
| **Trả nguyên byte audio của Google cho đúng dòng lỗi** | **đứng** |

## Chỗ đứng cố định theo chỉ số đoạn, không theo nội dung

Dựng lại thứ tự phát từ độ lệch preload — app xin đoạn N+2 khi bắt đầu phát đoạn N.
Khớp từng giây cho tới lúc hỏng:

```
đoạn 5 'Nếu như chỉ có mỗi Yoo Daon...'  bắt đầu 04:39:13, 6,96s -> hết 04:39:20  ✓
đoạn 6 'Một trong ba trường hợp đấy thôi.' bắt đầu 04:39:20, 2,00s -> hết 04:39:22  ✓
đoạn 7 'Ầm'                               bắt đầu 04:39:22
                                           KHÔNG BAO GIỜ xin đoạn 10
```

Người dùng xác nhận **không nghe thấy chữ "Ầm"**, và **không có dòng nào** nằm giữa
`-Ầm!` với dòng kế tiếp. Nghĩa là player đang giữ trong tay một file đã tải xong từ
nhiều giây trước, bắt đầu đoạn đó, rồi không render ra gì.

Chỗ đứng luôn ở cùng một chỉ số đoạn, bất kể văn bản, byte audio, độ dài, format hay
sample rate. Đó là chữ ký của một **bộ đếm**, không phải của nội dung.

## Vòng lặp thử lại vô hạn

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
mãi mãi. Giao diện không hề báo gì trong suốt thời gian đó.

## Rò rỉ MediaCodec

Đếm trong cùng phiên, chỉ tính PID của app:

```
CreateByType           : 30
setState RELEASING     : 15
setState UNINITIALIZED : 15
```

**Tạo 30, giải phóng 15.** Số hiệu instance decoder trong phiên chạy từ `#118` tới
`#770`.

Số codec đồng thời một tiến trình được cấp là có hạn và **khác nhau theo thiết bị** —
khớp với việc máy thật đứng còn MuMuPlayer (decoder phần mềm) phát trọn. Việc bấm
skip rồi chạy tiếp cũng khớp, nếu skip làm player dựng lại và thả các handle rò rỉ.

## Đề nghị

1. **Player vào vòng lặp thử lại vô hạn thay vì bỏ qua đoạn hoặc báo lỗi.** Đây là
   lỗi độc lập với engine: đứng câm 2,5 phút mà giao diện không báo gì. Kể cả khi
   nguyên nhân gốc nằm chỗ khác, hành vi này cần sửa riêng.
2. **MediaCodec tạo ra nhiều gấp đôi số được giải phóng** (30 vs 15 trong một phiên).
3. Tái hiện: chương dài, **Chia nội dung = Theo câu**, máy thật (không phải giả lập).
   Đứng ở cùng một đoạn với **cả ZeroTTS lẫn Google TTS**.
4. Trích log trong `logcat-evidence.txt` (không chứa nội dung truyện).

## Giảm nhẹ cho người dùng

Nếu thứ quyết định là **số đoạn** chứ không phải nội dung thì ít đoạn hơn sẽ đi xa hơn:

- **Chia nội dung = Theo đoạn** thay vì Theo câu
- **Độ dài tối đa** đặt cao (300–500)

Người dùng đã tự quan sát được là chuyển sang chia theo đoạn thì đi xa hơn hẳn.
Đây là giảm nhẹ, không phải sửa.
