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

Audio ra là MP3. `app.py` trong `docker/` đặt `gr.Audio(format="mp3")`; bản gốc trên
HF Space phục vụ WAV thô 48 kHz, nặng gấp ~5,4 lần và vBook phát được vài câu là tắt
tiếng. Xem mục "Vì sao MP3" bên dưới.

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

### Timeout: không có gì để chỉnh trong app

Bản vBook thực tế **không hiện mục `timeout` nào** — màn cài đặt extension chỉ có đúng
các key do `plugin.json` khai báo. Hai bản trước của tài liệu này bảo "bắt buộc nâng
`timeout` lên 300000" rồi "đặt 60000"; **cả hai đều sai**, chúng hướng dẫn chỉnh một
control không tồn tại.

`reference/extension-api.md` liệt kê `timeout` là built-in connection setting, nhưng ảnh
chụp màn hình thật cho thấy không có. Tin ảnh chụp, đừng tin tài liệu.

Timeout duy nhất có tác dụng là các hằng số nằm trong `src/tts.js`:

```js
const SUBMIT_TIMEOUT   = 15000;
const RENDER_TIMEOUT   = 60000;
const DOWNLOAD_TIMEOUT = 30000;
```

Mỗi `fetch` của vBook là đồng bộ và chặn luồng gọi, mà `execute()` gọi ba cái liên tiếp,
nên tổng ba số trên chính là khoảng thời gian một luồng của app bị giữ khi có sự cố.
Đặt rộng tay không phải "an toàn": bản đầu để `RENDER_TIMEOUT = 300000` và app bị đơ.
Muốn đổi thì sửa thẳng trong `tts.js` rồi `python build.py`.

`max_length` để `120` chứ không phải `200` như Google TTS là có lý do: Google trả MP3
(~40 KB mỗi đoạn). Với backend trong `docker/` đã đổi sang MP3 thì kích thước tương
đương, nên con số này không còn gắt như trước. Nhưng nếu app chia **theo câu** thì
`max_length` chỉ là trần, không phải đích — nâng lên cũng không làm đoạn dài thêm.

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

Cả ba đều trả audio hợp lệ. Backend trong `docker/` trả MP3 (~28-46 KB mỗi câu);
HF Space mặc định vẫn trả WAV `RIFF` 48 kHz mono (~245 KB cùng câu đó).

## Vì sao MP3, không phải WAV

Triệu chứng: vBook phát được vài câu rồi im hẳn, không báo lỗi, không tạm dừng TTS.

Đo được, theo thứ tự loại trừ:

- Backend phục vụ trọn vẹn mọi lần — 40 đoạn tuần tự và 18 request đồng thời, 0 lỗi,
  RAM phẳng, tunnel 0 lỗi. Không phải backend.
- Theo dõi bộ đếm request lúc app im: app vẫn gọi được và backend vẫn trả đủ, nhưng
  không ra tiếng. Lỗi nằm ở khâu phát, không phải khâu lấy dữ liệu.
- Đối chứng: **Google TTS đọc cùng chương đó bình thường**. Cùng app, cùng máy, cùng
  chương — chỉ khác engine. Chương vẫn còn nhiều nội dung phía sau chỗ dừng.

Khác biệt còn lại giữa hai engine là thứ trả về: Google trả MP3 ~40 KB mỗi câu, ZeroTTS
mặc định trả WAV thô ~245 KB. vBook giữ dữ liệu này dưới dạng chuỗi base64, nên WAV
chiếm gấp khoảng 12 lần bộ nhớ sau khi tính cả base64 và chuỗi UTF-16.

`format="mp3"` đưa kích thước về đúng tầm Google TTS. Đây là chỗ **duy nhất** `app.py`
lệch khỏi bản gốc trên HF Space, và cần `ffmpeg` trong image để pydub encode được.

MP3 **không** cải thiện thông lượng: RTF trước 1,09-1,19, sau vẫn 1,17. Nó chỉ tiết
kiệm ~0,17 s ở khâu tải. Khoảng trống giữa các đoạn là vấn đề khác, chưa giải quyết.

## Dòng không có gì để đọc phải trả khoảng lặng, không phải lỗi

Đây là nguyên nhân làm vBook đọc được vài câu rồi im hẳn.

Truyện dịch đầy những dòng chỉ có dấu câu — dòng ba chấm, dòng ngoặc kép trống, dòng
chỉ một dấu hỏi. Với những dòng đó ZeroTTS không sinh ra âm nào, và bản đầu của
`tts.js` trả `Response.error`. vBook gặp lỗi TTS thì **dừng phát cả chương, không hiện
thông báo nào** — nên triệu chứng là đang đọc bỗng im, app vẫn tưởng mình đang chạy.

Vì thế dừng ở chỗ khác nhau mỗi lần: nó dừng ở dòng "câm" đầu tiên của chương, mà vị
trí dòng đó thì tuỳ chương.

Đo bằng `test/shortlines.js` — chạy thẳng `execute()` trên 12 dạng dòng ngắn:

| Dạng dòng | Trước | Sau |
|-----------|-------|-----|
| có chữ (kể cả một tiếng "Ừ") | OK | OK |
| chỉ dấu câu (`?`, `…`, `……`) | **lỗi** — backend không sinh audio | khoảng lặng |
| rỗng sau khi làm sạch (`""`, `()`, `[]`, khoảng trắng) | **lỗi** | khoảng lặng |

7/12 dạng gây lỗi trước khi sửa, 0/12 sau khi sửa.

`SILENT_MP3` trong `tts.js` là clip câm 0,3 giây, MP3 mono 24 kHz, 1676 byte, dựng bằng
`ffmpeg -f lavfi -i anullsrc`. Nhúng thẳng vào script nên dòng câm không tốn một lượt
gọi mạng nào.

Nguyên tắc chung: **đừng để một câu hỏng chặn cả chương.** Lỗi mạng thật thì vẫn trả
`Response.error` để còn biết đường sửa, nhưng "backend chạy xong mà không có âm" thì
trả khoảng lặng rồi đi tiếp.

Ngưỡng `base64.length` cũng hạ từ 1000 xuống 100: con số cũ viết cho WAV thô, mà MP3
của một tiếng "Ừ" chỉ 3,7 KB nên suýt bị bắt nhầm là audio rỗng.
