# vbook-extensions

Extension cho [vBook](https://vbook.app).

## Thêm repo vào vBook

Trong phần quản lý nguồn/extension của app, chọn thêm nguồn từ link rồi dán:

```
https://raw.githubusercontent.com/justateaa/vbook-extensions/main/plugin.json
```

## Danh sách

| Extension | Loại | Mô tả |
|-----------|------|-------|
| [zerotts](zerotts/) | `tts` | TTS tiếng Việt bằng [ZeroTTS](https://huggingface.co/zeroweight-ai/ZeroTTS), 8 giọng dựng sẵn |

### ZeroTTS — đọc trước khi cài

Extension này **không tự chạy được một mình**. ZeroTTS không có API công khai của nhà
phát hành; mô hình chạy local qua Python/ONNX. Extension nói chuyện với một Gradio app
phơi `api_name="synthesize"`.

Mặc định trỏ vào một HF Space cộng đồng — dùng thử thì được, nhưng phần cứng
`cpu-basic` dùng chung cho RTF ~1,8× (chậm hơn thời gian thực). Nghe truyện dài thì
phải tự host. Thư mục [`zerotts/docker/`](zerotts/docker/) có sẵn `docker compose`
dựng backend trong một lệnh.

Sau khi cài **bắt buộc** nâng `timeout` trong cài đặt kết nối của extension lên
`60000` (đừng đặt 300000 — timeout dài giữ luồng của app và làm app đơ). Chi tiết trong [`zerotts/README.md`](zerotts/README.md).

## Build

`plugin.json` ở root là file index vBook đọc, và các `plugin.zip` đều do script sinh ra
— đừng sửa tay:

```bash
python build.py
```

Script đọc `metadata` từ `plugin.json` của từng extension, đóng gói `plugin.json` +
`icon.png` + `src/` thành zip phẳng, rồi dựng lại index.

## Ghi công

- [`zeroweight-ai/ZeroTTS`](https://huggingface.co/zeroweight-ai/ZeroTTS) — mô hình và
  thư viện, MIT. Codec MOSS-Audio-Tokenizer đi kèm là Apache-2.0.
- [`zerotts/docker/app.py`](zerotts/docker/app.py) — chép nguyên từ Space
  [`hugging-apps/zerotts-vietnamese-demo`](https://huggingface.co/spaces/hugging-apps/zerotts-vietnamese-demo),
  MIT. Giữ nguyên byte có chủ đích: đó chính là bản đã xác minh có endpoint
  `synthesize` mà extension dựa vào.
