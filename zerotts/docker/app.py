"""ZeroTTS — Vietnamese zero-shot text-to-speech, ONNX + numpy, no PyTorch.

Mirrors the reference implementation shipped by the authors
(github.com/zeroweight-ai/ZeroTTS, `webui/engine.py`): Vietnamese number/date
normalization → punctuation normalization → sentence chunking → one
`ZeroTTS.synthesize` call per segment → join with short gaps. Sampling defaults
are the ones the published benchmark numbers were produced with.

The model is an ONNX graph designed for CPU (RTF ~0.5x with 8 threads), so this
Space runs on cpu-basic — there is no PyTorch/CUDA path to put on a GPU.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import time

import gradio as gr
import numpy as np

from zerotts import ZeroTTS
from zerotts.audio import concat_with_silence
from zerotts.chunking import (
    chunk_text,
    clean_segment_punctuation,
    normalize_punctuation,
)
from zerotts.text_norm import normalize_vi_text

# Bật access log của uvicorn: cần nhìn TỪNG request HTTP, kể cả lượt tải file
# /gradio_api/file=..., để biết app có quay lại lấy audio hay không. Suy từ bộ
# đếm tổng của tunnel là đoán, không phải đo.
_ah = logging.StreamHandler()
_ah.setFormatter(logging.Formatter("[HTTP] %(message)s"))
for _n in ("uvicorn.access", "uvicorn.error"):
    _lg = logging.getLogger(_n)
    _lg.setLevel(logging.INFO)
    _lg.addHandler(_ah)
    _lg.propagate = False

# Tự encode MP3 thay vì để Gradio/pydub làm, chỉ để bỏ được metadata gapless.
#
# So byte với Google TTS (engine duy nhất chạy thông trên cùng app, cùng chương):
# Google trả luồng khung MP3 trần — byte đầu ff f3, không ID3, không Xing/LAME,
# start_time 0. Bản ffmpeg mặc định của ta gắn ID3 + header Info/LAME và khai
# báo độ trễ encoder 0,023s. Player đọc header LAME để cắt mép gapless sẽ xử lý
# sai với file rất ngắn, và cơ chế này KHÔNG phụ thuộc độ dài — đúng với việc
# đệm mọi clip lên 2 giây trước đó không cứu được gì.
def _encode_mp3_bare(pcm_i16, sample_rate: int) -> str:
    """PCM 16-bit mono -> MP3 trần (không ID3/Xing/LAME/delay) hoặc WAV."""
    os.makedirs("/tmp/zerotts_out", exist_ok=True)
    suffix = ".wav" if OUT_FORMAT == "wav" else ".mp3"
    fd, path = tempfile.mkstemp(suffix=suffix, dir="/tmp/zerotts_out")
    os.close(fd)
    common = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
        "-ar", str(MP3_RATE),
    ]
    if OUT_FORMAT == "wav":
        args = common + ["-c:a", "pcm_s16le", path]
    else:
        args = common + [
            "-c:a", "libmp3lame", "-b:a", "64k",
            "-write_xing", "0", "-id3v2_version", "0", "-map_metadata", "-1",
            path,
        ]
    subprocess.run(args, input=pcm_i16.tobytes(), check=True)
    return path


MODEL_ID = "zeroweight-ai/ZeroTTS"
MAX_TEXT_CHARS = 1000

# cpu-basic is 2 vCPU. os.cpu_count() reports the host's cores, not the
# cgroup limit, so asking for more intra-op threads than that only adds
# contention — measured slower than 2 on the live Space.
N_THREADS = int(os.environ.get("ZEROTTS_THREADS", "2"))

# Số job tổng hợp chạy song song. Bản gốc cố định 1. Sweep cho thấy ONNX của
# model này không nhanh thêm khi vượt 2 luồng (2 luồng và 4 luồng cùng ~0,85
# RTF), nên chạy 2 worker 2 luồng dùng lõi tốt hơn 1 worker 4 luồng.
N_CONCURRENCY = int(os.environ.get("ZEROTTS_CONCURRENCY", "1"))

# Độ dài tối thiểu của mỗi clip trả về, tính bằng giây.
# Player nối liền của vBook gãy khi gặp clip quá ngắn: đo được nó dừng hẳn ở
# các clip 0,5-1,0s (dòng tượng thanh, thoại một tiếng, mẩu câu bị cắt tại dấu
# ba chấm), trong khi clip 1,4s vẫn chạy. Chèn im lặng vào cuối cho đủ ngưỡng
# là chặn được cả lớp lỗi đó tại một chỗ, thay vì vá theo từng dạng văn bản.
MIN_CLIP_SEC = float(os.environ.get("ZEROTTS_MIN_SEC", "2.0"))

# Sample rate của MP3 xuất ra. Model chạy 48 kHz, nhưng đây là thứ người dùng
# nhận. Cùng app cùng chương: MuMuPlayer (decoder phần mềm trên PC) phát qua
# được đoạn ngắn, điện thoại thật thì dừng — nên vấn đề nằm ở decoder phần cứng
# của máy. Google TTS chạy thông trên đúng máy đó và nó trả 24 kHz (MPEG-2
# Layer III); ta trả 48 kHz (MPEG-1). Đó là khác biệt cấu trúc cuối cùng còn lại.
MP3_RATE = int(os.environ.get("ZEROTTS_MP3_RATE", "24000"))

# "mp3" hoặc "wav". WAV để đi vòng hẳn decoder phần cứng của máy: MP3 đã khớp
# Google tới từng byte frame header mà điện thoại vẫn dừng, nên nếu WAV chạy
# được thì lỗi nằm trong đường giải mã MP3 của máy chứ không phải ở file.
OUT_FORMAT = os.environ.get("ZEROTTS_FORMAT", "mp3").lower()

# Độ dài khoảng lặng trả về cho dòng không có gì để đọc.
SILENCE_SEC = float(os.environ.get("ZEROTTS_SILENCE_SEC", "0.6"))

print(f"Loading {MODEL_ID} (onnxruntime, {N_THREADS} threads)…", flush=True)
_t0 = time.perf_counter()
tts = ZeroTTS.from_pretrained(MODEL_ID, intra_op_num_threads=N_THREADS)
SAMPLE_RATE = int(tts.sample_rate)
print(f"Loaded in {time.perf_counter() - _t0:.1f}s — voices: {tts.list_voices()}", flush=True)

# ── voices ───────────────────────────────────────────────────────────────────
# The weights ship eight preset voices. A "voice" here is a small array of
# speaker latents; cloning from arbitrary audio is NOT part of this release
# (the voice encoder is unpublished), so the picker is the whole story.

PREVIEW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voice_previews")
os.makedirs(PREVIEW_DIR, exist_ok=True)

VOICES: dict[str, dict] = {}
for _name in tts.list_voices():
    _v = tts.load_voice(_name)
    _preview = None
    if _v.preview_path and os.path.isfile(_v.preview_path):
        # Copy out of the HF cache so Gradio can serve it without allowed_paths.
        _preview = os.path.join(PREVIEW_DIR, f"{_name}.wav")
        if not os.path.isfile(_preview):
            shutil.copyfile(_v.preview_path, _preview)
    VOICES[_name] = {
        "label": f"{_v.display_name or _name} — {', '.join(_v.tags)}",
        "display_name": _v.display_name or _name,
        "tags": list(_v.tags),
        "preview": _preview,
    }

VOICE_CHOICES = [(v["label"], k) for k, v in VOICES.items()]
DEFAULT_VOICE = "maichi" if "maichi" in VOICES else next(iter(VOICES))

DEFAULT_TEXT = "Xin chào tất cả mọi người. Giọng nói này được tạo ra bởi ZeroTTS."


def voice_preview(voice: str) -> str | None:
    """Path to the shipped preview clip for a voice, or None.

    Args:
        voice: voice pack id, e.g. "maichi".
    """
    return VOICES.get(voice, {}).get("preview")


def _segments(text: str, max_chunk_sec: float, normalize_numbers: bool) -> list[str]:
    """Exactly the segments that will be sent to the model."""
    if normalize_numbers:
        text = normalize_vi_text(text)
    raw = chunk_text(normalize_punctuation(text), max_chunk_sec=float(max_chunk_sec))
    return [s for s in (clean_segment_punctuation(x) for x in raw) if s]


def synthesize(
    text: str,
    voice: str = DEFAULT_VOICE,
    cfg_scale: float = 1.0,
    temperature: float = 0.8,
    top_k: int = 25,
    top_p: float = 0.95,
    repetition_penalty: float = 1.2,
    eoa_extra_frames: int = 1,
    normalize_numbers: bool = True,
    max_chunk_sec: float = 15.0,
    progress=gr.Progress(),
    request: gr.Request | None = None,
) -> tuple[tuple[int, np.ndarray], str]:
    """Synthesize Vietnamese speech from text with one of the shipped voices.

    Args:
        text: Vietnamese text to read aloud (English words may be mixed in).
        voice: voice pack id — one of maichi, baotrang, hamy, kimoanh, giahuy,
            huuduc, quangminh, tiendat.
        cfg_scale: classifier-free guidance toward the voice identity. 1.0 is
            off (one forward pass per frame); above 1.0 costs ~2x.
        temperature: audio-token sampling temperature.
        top_k: audio-token top-k.
        top_p: audio-token nucleus threshold.
        repetition_penalty: per-codebook repetition penalty. 1.2 is the
            benchmarked default; 1.0 measurably raises WER.
        eoa_extra_frames: frames of audio kept past the model's stop signal.
        normalize_numbers: expand Vietnamese dates, times, numbers and acronyms
            to spoken words before synthesis.
        max_chunk_sec: target length of each synthesized segment, in seconds.

    Returns:
        The generated 48 kHz audio, and a one-line report of what was run.
    """
    _req_t = time.time()
    _req_id = f"{_req_t:.3f}"
    # Extension tự khai version qua header. Không có header nghĩa là bản cũ hoặc
    # một client khác (trình duyệt, curl) — biết ngay ai đang gọi, khỏi phải hỏi.
    _ext = "?"
    _ua = "-"
    if request is not None:
        try:
            _ext = request.headers.get("x-zerotts-ext", "-")
            # User-Agent phân biệt được máy thật với giả lập, và phân biệt hai
            # bản cài cùng lúc — đã mất một vòng đo vì tưởng nhầm máy nào gọi.
            _ua = (request.headers.get("user-agent") or "-")[:60]
        except Exception:
            _ext = "?"
    print(
        f"[REQ {_req_id}] ext=v{_ext} ua={_ua!r} len={len(text or '')} text={text!r}",
        flush=True,
    )

    text = (text or "").strip()
    if len(text) > MAX_TEXT_CHARS:
        print(f"[ERR {_req_id}] quá dài: {len(text)}", flush=True)
        raise gr.Error(
            f"Text is too long ({len(text)} characters, max {MAX_TEXT_CHARS} on this demo)."
        )
    if voice not in VOICES:
        voice = DEFAULT_VOICE

    segments = _segments(text, max_chunk_sec, normalize_numbers) if text else []
    if not segments:
        # Dòng chỉ có dấu câu, hoặc rỗng. Trả khoảng lặng đi qua ĐÚNG đường ống
        # encode của giọng, thay vì để extension trả một clip dựng sẵn: mọi clip
        # người dùng nhận phải giống nhau từng thuộc tính, và mọi đoạn phải hiện
        # trong log này. Trước đây mẩu chỉ-dấu-câu không bao giờ gọi tới đây nên
        # là điểm mù.
        print(f"[SIL {_req_id}] không có gì để đọc -> khoảng lặng", flush=True)
        pcm = np.zeros(int(SILENCE_SEC * SAMPLE_RATE), dtype=np.int16)
        out_path = _encode_mp3_bare(pcm, SAMPLE_RATE)
        return out_path, "khoảng lặng"

    t0 = time.perf_counter()
    chunks = []
    for i, segment in enumerate(segments):
        progress((i, len(segments)), desc=f"Segment {i + 1}/{len(segments)}")
        chunks.append(
            tts.synthesize(
                segment,
                voice=voice,
                cfg_scale=float(cfg_scale),
                audio_temperature=float(temperature),
                audio_topk=int(top_k),
                audio_topp=float(top_p),
                audio_repetition_penalty=float(repetition_penalty),
                eoa_extra_frames=int(eoa_extra_frames),
            )
        )
    progress((len(segments), len(segments)), desc="Decoding")

    audio = concat_with_silence(chunks, silence_sec=0.15, sample_rate=SAMPLE_RATE)
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)

    min_samples = int(MIN_CLIP_SEC * SAMPLE_RATE)
    if 0 < audio.shape[0] < min_samples:
        audio = np.concatenate(
            [audio, np.zeros(min_samples - audio.shape[0], dtype=np.float32)]
        )
    elapsed = time.perf_counter() - t0
    seconds = audio.shape[0] / SAMPLE_RATE

    report = (
        f"{VOICES[voice]['display_name']} · {len(segments)} segment(s) · "
        f"{seconds:.1f}s of audio in {elapsed:.1f}s "
        f"(RTF {elapsed / max(seconds, 1e-6):.2f}x on {N_THREADS} CPU threads)"
    )
    pcm = np.clip(audio * 32767.0, -32768, 32767).astype(np.int16)
    out_path = _encode_mp3_bare(pcm, SAMPLE_RATE)
    print(
        f"[OK  {_req_id}] {seconds:.2f}s audio, dựng mất {elapsed:.2f}s, "
        f"tổng trong hàm {time.time() - _req_t:.2f}s",
        flush=True,
    )
    return out_path, report


# Texts are the authors' own web-UI samples (webui/test_samples.txt in the
# ZeroTTS repo, MIT) — plain Vietnamese, code-switched English, numbers/dates,
# narration and a news read.
EXAMPLES = [
    ["Xin chào các bạn, mình là ZeroTTS.", "maichi"],
    ["Chào bạn! Hôm nay bạn khỏe không?", "hamy"],
    ["Chào John, anh khỏe không? Long time no see!", "tiendat"],
    [
        "Giảm giá 25% — nhưng chỉ khi bạn đặt 3/4 số lượng trước 17:00 hôm nay. "
        'Đây là chương trình "mua một tặng một" (có giới hạn), 100% thật, '
        "không phát sinh chi phí.",
        "quangminh",
    ],
    [
        "Anh Peter nói giảm 25% cho đơn hàng trên 3/4 triệu, xong deadline là "
        '5:00 p.m. hôm nay — deal này "hot" lắm đó, check it out ở link '
        "facebook.com/peter_shop nhé!",
        "giahuy",
    ],
    [
        "Ngày xưa, ở một ngôi làng nhỏ ven sông, có một ông lão đánh cá sống một "
        "mình trong túp lều tranh. Mỗi sáng, khi sương còn giăng kín mặt nước, "
        "ông lại chèo thuyền ra khơi, thả lưới rồi kiên nhẫn chờ đợi.",
        "huuduc",
    ],
    [
        "Theo thông báo của OpenAI, từ tuần tới, người dùng miễn phí và gói Go có "
        "thể trò chuyện văn bản thoải mái với ChatGPT. Tuy nhiên, việc tạo hình "
        "ảnh, tải lên tệp và sử dụng công cụ giọng nói trong chatbot vẫn sẽ bị "
        "hạn chế.",
        "baotrang",
    ],
]

CSS = """
#col-container { max-width: 1100px; margin: 0 auto; }
.dark .gradio-container { color: var(--body-text-color); }
"""

# Gradio 6 moved theme/css off the Blocks constructor and onto launch().
with gr.Blocks(title="ZeroTTS — Vietnamese TTS") as demo:
    with gr.Column(elem_id="col-container"):
        gr.Markdown(
            """
# ZeroTTS — Vietnamese text-to-speech

A 202M-parameter ONNX model that reads Vietnamese (and the English words that
show up inside it) with 1.03% WER — about 4x fewer word errors than the next
open Vietnamese system — and runs faster than real time on a plain CPU.

[Model](https://huggingface.co/zeroweight-ai/ZeroTTS) ·
[GitHub](https://github.com/zeroweight-ai/ZeroTTS) ·
[Benchmark](https://huggingface.co/datasets/zeroweight-ai/ZeroBench-TTS) ·
[Blog](https://zeroweight.ai/blog/zero-tts)
"""
        )

        with gr.Row():
            with gr.Column(scale=3):
                text = gr.Textbox(
                    label="Text",
                    value=DEFAULT_TEXT,
                    lines=6,
                    max_lines=16,
                    placeholder="Nhập văn bản tiếng Việt…",
                    info=f"Vietnamese, up to {MAX_TEXT_CHARS} characters. "
                    "Dates, times and numbers are read correctly as written.",
                )
                run = gr.Button("Generate speech", variant="primary")
            with gr.Column(scale=2):
                voice = gr.Dropdown(
                    choices=VOICE_CHOICES,
                    value=DEFAULT_VOICE,
                    label="Voice",
                    info="Eight preset voices ship with the weights.",
                )
                preview = gr.Audio(
                    label="Voice preview",
                    value=voice_preview(DEFAULT_VOICE),
                    interactive=False,
                )

        # format="mp3" là chỗ DUY NHẤT lệch khỏi bản app.py gốc trên HF Space.
        # Mặc định Gradio phục vụ WAV thô 48 kHz, ~350 KB cho một câu. vBook tải
        # về rồi giữ dưới dạng chuỗi base64; với payload cỡ đó thì phát được vài
        # câu là tắt tiếng, trong khi Google TTS (MP3 ~40 KB) chạy bình thường
        # trên cùng app cùng chương. MP3 nhỏ hơn khoảng 12 lần.
        # Cần ffmpeg trong image thì pydub mới encode được — xem Dockerfile.
        audio_out = gr.Audio(label="Output", type="filepath", autoplay=False)
        status = gr.Textbox(label="Run details", interactive=False, lines=1)

        with gr.Accordion("Advanced settings", open=False):
            with gr.Row():
                cfg_scale = gr.Slider(
                    1.0, 4.0, value=1.0, step=0.1,
                    label="CFG scale (voice guidance)",
                    info="1.0 = off. Above 1.0 pushes harder toward the voice "
                         "identity at roughly 2x the cost per frame.",
                )
                temperature = gr.Slider(0.1, 1.5, value=0.8, step=0.05, label="Temperature")
            with gr.Row():
                top_k = gr.Slider(1, 200, value=25, step=1, label="Top-k")
                top_p = gr.Slider(0.1, 1.0, value=0.95, step=0.01, label="Top-p")
            with gr.Row():
                repetition_penalty = gr.Slider(
                    1.0, 2.0, value=1.2, step=0.05, label="Repetition penalty",
                    info="1.2 is the benchmarked default; 1.0 raises WER.",
                )
                eoa_extra_frames = gr.Slider(
                    0, 4, value=1, step=1, label="Tail frames after stop",
                    info="Frames kept past the stop signal (0.08s each).",
                )
            with gr.Row():
                normalize_numbers = gr.Checkbox(
                    value=True, label="Expand Vietnamese numbers, dates and acronyms",
                )
                max_chunk_sec = gr.Slider(
                    5, 25, value=15, step=1, label="Max segment length (seconds)",
                )

        INPUTS = [
            text, voice, cfg_scale, temperature, top_k, top_p,
            repetition_penalty, eoa_extra_frames, normalize_numbers, max_chunk_sec,
        ]

        gr.Examples(
            examples=EXAMPLES,
            inputs=[text, voice],
            outputs=[audio_out, status],
            fn=synthesize,
            cache_examples=True,
            cache_mode="lazy",
            label="Examples (from the ZeroTTS repo's own sample texts)",
        )

        gr.Markdown(
            "Voice cloning from your own reference audio is **not** part of this "
            "release — the voice encoder is unpublished, so the eight preset "
            "voices above are the only speakers available. "
            "Please disclose synthetic speech as synthetic."
        )

    voice.change(fn=voice_preview, inputs=voice, outputs=preview, api_name="voice_preview")
    gr.on(
        triggers=[run.click, text.submit],
        fn=synthesize,
        inputs=INPUTS,
        outputs=[audio_out, status],
        api_name="synthesize",
        concurrency_limit=N_CONCURRENCY,
    )

if __name__ == "__main__":
    # Mount lên FastAPI của mình thay vì demo.launch(), chỉ để cài được middleware
    # ghi TỪNG request HTTP — gồm cả lượt tải /gradio_api/file=..., thứ mà log
    # trong hàm synthesize không thấy. Cần biết app có quay lại lấy audio không.
    import inspect

    import uvicorn
    from fastapi import FastAPI

    fastapi_app = FastAPI()

    @fastapi_app.middleware("http")
    async def _log_http(request, call_next):
        t0 = time.time()
        response = await call_next(request)
        path = request.url.path
        if len(path) > 70:
            path = path[:34] + "…" + path[-34:]
        print(
            f"[HTTP] {request.method:4} {path} -> {response.status_code} "
            f"{time.time() - t0:.2f}s",
            flush=True,
        )
        return response

    _queued = demo.queue(default_concurrency_limit=N_CONCURRENCY)
    _kw = {}
    if "css" in inspect.signature(gr.mount_gradio_app).parameters:
        _kw["css"] = CSS
    mounted = gr.mount_gradio_app(fastapi_app, _queued, path="/", **_kw)
    uvicorn.run(
        mounted,
        host=os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1"),
        port=int(os.environ.get("GRADIO_SERVER_PORT", "7860")),
        log_level="warning",
    )
