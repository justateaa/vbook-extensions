# ZeroTTS — extension TTS cho vBook

Đọc truyện bằng [ZeroTTS](https://huggingface.co/zeroweight-ai/ZeroTTS) — mô hình TTS
tiếng Việt 202M tham số, 8 giọng dựng sẵn, giấy phép MIT.

## Điều cần biết trước

ZeroTTS **không có API công khai của nhà phát hành**. Mô hình chạy local qua thư viện
Python/ONNX (`pip install zerotts`), chỉ có thư viện, CLI, Gradio web UI và bản demo
WASM chạy trong trình duyệt. Script vBook thì chỉ gọi được HTTP.

Nên extension này nói chuyện với một **Gradio app phơi `api_name="synthesize"`**. Luồng
gọi trong `src/tts.js` là 3 chặng:

1. `POST /gradio_api/call/v2/synthesize` → nhận `event_id`
2. `GET /gradio_api/call/synthesize/<event_id>` → đọc SSE tới khi `event: complete`, rút URL file
3. `GET <url file>` → `response.base64()` → trả cho app

Audio ra là WAV 48 kHz, mono, 16-bit.

## Backend

### Mặc định: Space công khai

Cài xong là chạy được ngay, không cần API key. Nhưng đây là Space cộng đồng, phần cứng
`cpu-basic` miễn phí dùng chung:

- Đo thực tế: **RTF ~1.8×** — tổng hợp 2,6 s audio mất 4,5 s. Tức là **chậm hơn thời
  gian thực**, tải trước tuần tự không bao giờ đuổi kịp tốc độ nghe.
- Space có thể ngủ, xếp hàng, giới hạn tần suất, hoặc bị chủ sở hữu xoá bất cứ lúc nào.

Dùng để thử cho biết thì được. Nghe truyện dài thì nên tự host.

### Tự host (khuyến nghị)

Cùng một giao thức, chỉ đổi `ZEROTTS_URL` trong cài đặt extension.

**Cách 1 — Docker (thư mục `docker/`).**

```bash
cd docker
docker compose up -d --build
docker compose logs -f zerotts     # chờ dòng "Loaded in ...s — voices: [...]"
```

Lần đầu tải ~900 MB trọng số vào volume `hf-cache`; rebuild sau không tải lại. Backend
nằm ở `http://<IP máy>:7860`.

Compose dựng kèm sidecar `cloudflared` chạy quick tunnel, cấp một URL
`*.trycloudflare.com` public. Lấy URL:

```bash
docker compose logs cloudflared | grep -o 'https://.*\.trycloudflare\.com'
```

> **Quick tunnel là URL công khai, không có xác thực.** Ai có link đều gọi được backend
> và chiếm CPU máy bạn. URL ngẫu nhiên nên khó đoán, nhưng đừng đăng ra chỗ công khai.
> URL sống cùng container: dừng container là link chết vĩnh viễn, chạy lại sẽ ra URL mới
> và phải sửa lại `ZEROTTS_URL` trong app. Chỉ cần dùng trong nhà thì xoá service
> `cloudflared` khỏi `docker-compose.yml` và dùng thẳng IP LAN.

**Cách 2 — nhân bản Space.** Mở
[hugging-apps/zerotts-vietnamese-demo](https://huggingface.co/spaces/hugging-apps/zerotts-vietnamese-demo)
→ *Duplicate this Space*. Rồi điền `ZEROTTS_URL` = `https://<user>-<tên-space>.hf.space`.

**Cách 3 — chạy pip trần.** Lấy `app.py` + `requirements.txt` của Space đó rồi:

```bash
pip install -r requirements.txt gradio==6.27.0
GRADIO_SERVER_NAME=0.0.0.0 ZEROTTS_THREADS=4 python app.py
```

`app.py` gọi `launch()` không có `server_name`, mà mặc định của Gradio là bind
`127.0.0.1` — nên **phải** ép qua biến môi trường. Không có cờ CLI nào làm việc này.
Ghim `gradio==6.27.0`: bản khác có thể đổi dạng endpoint `/gradio_api/call/v2/<api_name>`
mà extension đang dựa vào.

> Lưu ý: `webui/app.py` trong repo GitHub chính chủ **không** đặt `api_name` tường minh
> nên không dùng thay thế được — phải là app có endpoint `synthesize`.

### Số luồng CPU quyết định có nghe mượt hay không

`ZEROTTS_THREADS` trong `docker-compose.yml`. RTF = thời gian tổng hợp / độ dài audio;
trên 1,0 là chậm hơn thời gian thực, hàng đệm sẽ cạn dần và cuối cùng hết tiếng.

**Nhiều luồng hơn KHÔNG phải nhanh hơn.** Số đo thật bằng `test/sweep.sh`, 3 lần mỗi
mức, RTF do chính engine báo:

| Luồng | RTF | |
|-------|-----|---|
| 2 | 0,86 / 0,84 / 0,83 | |
| 3 | 0,87 / 0,85 / 0,77 | |
| 4 | 0,84 / 0,86 / 0,92 | ← mặc định |
| 6 | 1,84 / 1,87 / 1,80 | vách dốc |
| 8 | ~2,9 | chậm gấp 3,5× so với 4 |

Tối ưu nằm ở **2–4 luồng**, và có vách dốc ngay trên 4. `app.py` đã cảnh báo trước:
`os.cpu_count()` trả về số lõi của host chứ không phải hạn mức cgroup, nên xin nhiều
luồng hơn mức thật sự được cấp chỉ tạo tranh chấp. Đừng nâng lên 8.

Chạy `sh test/sweep.sh "2 3 4 6"` để tự quét trên máy bạn — điểm tối ưu phụ thuộc số
lõi Docker thật sự được cấp.

Bật **Tải trước song song** gần như vô ích: đo được 2 request song song chỉ nhanh hơn
tuần tự 12% (13,0 s → 11,4 s), vì `app.py` đặt `default_concurrency_limit=1` và bản
thân việc tổng hợp đã bão hoà CPU. Cứ để `false`.

### Kích thước đoạn quan trọng ngang số luồng

Mỗi đoạn tốn khoảng **1 giây overhead cố định** (submit + tải file) bất kể dài ngắn.
Đoạn càng ngắn thì overhead đó chiếm tỷ trọng càng lớn. Đo bằng `test/soak.js`:

| Đoạn | Audio tạo ra | RTF tổng |
|------|--------------|----------|
| ~105 ký tự | 6,5 s | 1,11 — cạn đệm |
| ~320 ký tự | 19,6 s | 0,99 — hoà vốn |

Nhưng nếu app đặt **Chia nội dung = Theo câu** thì mỗi đoạn là một câu, `max_length`
có nâng cũng không đổi gì. Muốn dùng được lever này phải đổi sang chế độ chia theo
đoạn văn hoặc theo độ dài.

### Tunnel không phải nút thắt

Đo local (`127.0.0.1`) so với qua tunnel: 1,03 vs 1,11 (đoạn ngắn), 1,00 vs 0,99
(đoạn dài). Tunnel chỉ tốn ~0,05–0,08 RTF. Nút thắt là chính engine.

Trên Docker Desktop (Linux trong VM) engine chạy khoảng **0,85 RTF**, không phải 0,5×
như model card ghi. Muốn có biên thật sự thì phải cấp thêm CPU cho Docker, hoặc chạy
ZeroTTS thẳng trên host thay vì trong container.

## Cài đặt

| Khoá | Mặc định | Ý nghĩa |
|------|----------|---------|
| `ZEROTTS_URL` | Space công khai | Địa chỉ Gradio backend |
| `ZEROTTS_CFG_SCALE` | `1.0` | 1.0 = tắt; cao hơn bám giọng gốc hơn nhưng dễ méo (1.0–4.0) |
| `ZEROTTS_TEMPERATURE` | `0.8` | Thấp = đều, cao = giàu biểu cảm nhưng dễ vấp (0.1–1.5) |
| `preload_size` | `2` | Số câu tổng hợp trước |
| `preload_parallel` | `false` | Bật khi tự host |
| `max_length` | `120` | Ký tự tối đa mỗi lượt |

### Request timeout: đặt khoảng `60000`

Trong mục cài đặt kết nối của extension. **Đừng đặt 300000** — bản trước của tài liệu
này khuyên như vậy và đó là lời khuyên sai.

Mỗi `fetch` của vBook là đồng bộ và chặn luồng gọi, mà `execute()` gọi ba cái liên tiếp.
Timeout không phải mức "an toàn" để đặt rộng tay: nó chính là khoảng thời gian một luồng
của app bị giữ khi có sự cố. App tải trước nhiều đoạn cùng lúc trong khi backend xử lý
tuần tự, nên các đoạn sau vốn đã phải chờ; timeout dài làm nhiều luồng bị giữ cùng lúc
cho tới khi app đơ.

Mặc định 30 s của app thì hơi sát: đo được 16,3 s khi bị bắn 3 request đồng thời, chưa
kể tổng hợp lâu hơn nếu backend yếu. `60000` cho biên gấp ~3,7× mức tệ nhất từng đo mà
vẫn không giữ luồng quá lâu.

`max_length` để `120` chứ không phải `200` như Google TTS là có lý do: Google trả MP3
(~40 KB mỗi đoạn), ZeroTTS trả WAV thô 48 kHz — 120 ký tự đã là ~800 KB WAV, thành chuỗi
base64 còn phình thêm. Tăng lên thì vừa tốn bộ nhớ vừa dễ chạm trần timeout.

## Giọng

Tên và mô tả lấy nguyên từ `voices/index.json` của repo mô hình.

| ID | Tên | Mô tả |
|----|-----|-------|
| `maichi` | Mai Chi | nữ, trẻ, kể chuyện, nhẹ nhàng, thân thiện |
| `kimoanh` | Kim Oanh | nữ, trung niên, kể chuyện, ấm áp, truyền cảm |
| `giahuy` | Gia Huy | nam, trẻ, kể chuyện, trầm ấm, tâm tình |
| `huuduc` | Hữu Đức | nam, lớn tuổi, kể chuyện, trầm, điềm đạm |
| `baotrang` | Bảo Trang | nữ, trưởng thành, tin tức, rõ ràng, trung tính |
| `quangminh` | Quang Minh | nam, trẻ, tin tức, rõ ràng, dứt khoát |
| `tiendat` | Tiến Đạt | nam, trẻ, bình luận, sôi nổi, năng lượng cao |
| `hamy` | Hà My | nữ, trẻ, hoạt hình, cao, biểu cảm |

Không nhân bản giọng mới được: bộ mã hoá giọng (voice encoder) chưa được công bố.

## Cấu trúc

```
zerotts/
├── plugin.json
├── icon.png
├── src/
│   ├── tts.js          # tổng hợp 1 câu -> base64
│   ├── voice.js        # trả danh sách giọng
│   └── voice_list.js   # dữ liệu 8 giọng
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml   # zerotts + sidecar cloudflared
│   ├── requirements.txt     # ghim gradio==6.27.0
│   └── app.py               # nguyên bản HF Space, không vá
└── test/
    └── harness.js      # chạy tts.js ngoài app để kiểm thử
```

## Kiểm thử

`test/harness.js` nạp thẳng `src/tts.js` vào một sandbox mô phỏng môi trường Rhino của
vBook — `fetch` đồng bộ, `Response.success/error`, config inject dạng `const`.

```bash
node test/harness.js              # 14 kiểm tra offline: parser SSE, làm sạch text, chọn giọng
ZT_LIVE=1 node test/harness.js    # thêm 3 kiểm tra gọi thật backend
ZT_URL=http://192.168.1.10:7860 ZT_LIVE=1 node test/harness.js   # kiểm thử bản tự host
```

Kết quả đo được, cùng một câu thử:

| Backend | Kết quả | Thời gian |
|---------|---------|-----------|
| Space công khai | 17/17 pass | 13,3 s (có xếp hàng) |
| Docker local, 4 luồng | 17/17 pass | 4,2 s |
| Docker qua tunnel | 17/17 pass | 5,9 s |

Cả ba đều trả WAV `RIFF` 48 kHz mono hợp lệ.
