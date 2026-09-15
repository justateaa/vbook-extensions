load("voice_list.js");

// ZeroTTS không có API công khai của nhà phát hành: model chạy local qua thư viện
// Python/ONNX. Cầu nối duy nhất gọi được bằng HTTP là một Gradio app phơi
// api_name="synthesize". Mặc định trỏ vào Space công khai; đổi ZEROTTS_URL trong
// cài đặt extension để dùng Space nhân bản hoặc máy tự host (xem README).
let BASE_URL = "https://hugging-apps-zerotts-vietnamese-demo.hf.space";
try {
    // Phải kiểm kiểu, không chỉ kiểm truthy. Có bản app inject config vào đây
    // dưới dạng không phải chuỗi; gọi .indexOf/.charAt lên nó là ném lỗi ngay
    // lúc load, mà load lỗi thì execute() không bao giờ tồn tại -> app treo im
    // lặng, không hiện một chữ lỗi nào. Sai kiểu thì lặng lẽ dùng mặc định.
    if (typeof ZEROTTS_URL === "string" && ZEROTTS_URL.trim()) {
        BASE_URL = ZEROTTS_URL.trim();
    }
} catch (e) {
    // App chưa inject config -> giữ nguyên mặc định.
}
// Người tự host hay gõ thiếu scheme ("192.168.1.10:7860").
if (BASE_URL.indexOf("http://") !== 0 && BASE_URL.indexOf("https://") !== 0) {
    BASE_URL = "http://" + BASE_URL;
}
while (BASE_URL.charAt(BASE_URL.length - 1) === "/") {
    BASE_URL = BASE_URL.substring(0, BASE_URL.length - 1);
}

// Tham số sinh; chỉ mở 2 cái ảnh hưởng rõ nhất tới chất giọng ra ngoài cài đặt.
let CFG_SCALE = 1.0;
try {
    let cfgRaw = parseFloat(ZEROTTS_CFG_SCALE);
    if (!isNaN(cfgRaw) && cfgRaw >= 1.0 && cfgRaw <= 4.0) {
        CFG_SCALE = cfgRaw;
    }
} catch (e) {
}

let TEMPERATURE = 0.8;
try {
    let tempRaw = parseFloat(ZEROTTS_TEMPERATURE);
    if (!isNaN(tempRaw) && tempRaw >= 0.1 && tempRaw <= 1.5) {
        TEMPERATURE = tempRaw;
    }
} catch (e) {
}

// Dự phòng cuối cùng: chỉ dùng khi cả hai lần gọi backend đều hỏng ở khâu
// truyền. Mọi khoảng lặng bình thường giờ do backend sinh, qua đúng đường ống
// của giọng. Clip này lấy thẳng từ backend nên khớp mọi thuộc tính.
//
// Đây KHÔNG phải số 0 tuyệt đối mà là nhiễu -64 dBFS. Tầng âm thanh của máy
// theo dõi riêng luồng toàn-zero (logcat: "[audioTrackData][zero] ...
// mMaxAmplitude 0") và app đứng hình ngay sau một cụm 4 khoảng lặng liên tiếp.
const SILENT_MP3 = "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";

// Phải khớp metadata.version trong plugin.json — build.py kiểm, lệch là dừng.
// Gửi kèm mỗi request để backend log biết chính xác bản nào đang gọi.
const EXT_VERSION = "14";

const DEFAULT_VOICE = "maichi";
const MAX_CHARS = 1000;          // Trần của ô Text trong Gradio app.
// Mỗi fetch của vBook là đồng bộ và CHẶN luồng gọi. execute() gọi ba cái liên
// tiếp, nên tổng timeout chính là khoảng thời gian một luồng của app bị giữ.
// Đặt rộng tay ở đây không "an toàn" mà ngược lại: app bắn nhiều đoạn cùng lúc,
// backend xử lý tuần tự, các đoạn sau chờ lâu, và nếu timeout dài thì nhiều
// luồng bị giữ cùng lúc cho tới khi app đơ.
//
// Số đo thật (test/soak.js, test/concurrent.js): submit 0,26-0,86s; tổng hợp
// 5,4-6,6s tuần tự và tối đa 16,3s khi bị bắn 3 đồng thời; tải file 0,58-0,83s.
// Các trần dưới đây gấp nhiều lần mức tệ nhất từng đo mà tổng vẫn chỉ 105s.
const SUBMIT_TIMEOUT = 15000;
const RENDER_TIMEOUT = 60000;
const DOWNLOAD_TIMEOUT = 30000;

function execute(text, voiceId) {
    let voice = resolveVoice(voiceId);
    let payload = cleanText(text);

    // KHÔNG đi tắt cho dòng chỉ có dấu câu nữa. Trước đây những mẩu đó được trả
    // bằng clip nhúng sẵn mà không gọi backend, nên chúng vô hình trong log
    // backend — đúng chỗ tôi cần nhìn lại là chỗ không thấy được. Giờ mọi đoạn
    // đều đi qua backend: mỗi clip người dùng nghe đều sinh từ cùng một đường
    // ống, và mỗi đoạn đều để lại một dòng log.
    let audio = synthesizeOnce(payload, voice);
    if (!audio) {
        audio = synthesizeOnce(payload, voice);
    }
    return Response.success(audio || SILENT_MP3);
}

// Trả base64 audio, hoặc null nếu hỏng ở bất kỳ chặng nào.
function synthesizeOnce(payload, voice) {
    // Bước 1 - đẩy job vào hàng đợi Gradio, nhận event_id.
    let submit = fetch(BASE_URL + "/gradio_api/call/v2/synthesize", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-ZeroTTS-Ext": EXT_VERSION
        },
        body: JSON.stringify({
            text: payload,
            voice: voice,
            cfg_scale: CFG_SCALE,
            temperature: TEMPERATURE,
            top_k: 25,
            top_p: 0.95,
            repetition_penalty: 1.2,
            eoa_extra_frames: 1,
            normalize_numbers: true,
            max_chunk_sec: 15
        }),
        timeout: SUBMIT_TIMEOUT
    });
    if (!submit.ok) {
        console.log("ZeroTTS: submit HTTP " + submit.status);
        return null;
    }

    let eventId = null;
    try {
        eventId = submit.json().event_id;
    } catch (e) {
        console.log("ZeroTTS: phản hồi submit không phải JSON");
        return null;
    }
    if (!eventId) {
        console.log("ZeroTTS: không nhận được event_id");
        return null;
    }

    // Bước 2 - đọc stream SSE cho tới khi job xong, rút URL file.
    let stream = fetch(BASE_URL + "/gradio_api/call/synthesize/" + eventId, {
        headers: {"Accept": "text/event-stream"},
        timeout: RENDER_TIMEOUT
    });
    if (!stream.ok) {
        console.log("ZeroTTS: đọc kết quả HTTP " + stream.status);
        return null;
    }

    let fileUrl = parseAudioUrl(stream.text());
    if (!fileUrl) {
        console.log("ZeroTTS: backend không sinh ra audio cho: " + payload);
        return null;
    }

    // Bước 3 - tải file rồi trả base64 cho app.
    let audio = fetch(fileUrl, {timeout: DOWNLOAD_TIMEOUT});
    if (!audio.ok) {
        console.log("ZeroTTS: tải audio HTTP " + audio.status);
        return null;
    }

    let base64 = audio.base64();
    // Ngưỡng cũ 1000 viết cho WAV thô; MP3 một câu ngắn nhỏ hơn nhiều.
    if (!base64 || base64.length < 100) {
        console.log("ZeroTTS: audio tải về rỗng");
        return null;
    }
    return base64;
}

// Gradio trả SSE: mỗi bản ghi là cặp dòng "event: <tên>" rồi "data: <json>".
// Lấy cặp cuối cùng; "complete" mới có file, "error"/"cancel" thì bỏ.
function parseAudioUrl(body) {
    if (!body) {
        return null;
    }

    let lines = body.split("\n");
    let currentEvent = "";
    let finalEvent = "";
    let finalData = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.charAt(line.length - 1) === "\r") {
            line = line.substring(0, line.length - 1);
        }
        if (line.indexOf("event:") === 0) {
            currentEvent = line.substring(6).trim();
        } else if (line.indexOf("data:") === 0) {
            finalData = line.substring(5).trim();
            finalEvent = currentEvent;
        }
    }

    if (finalEvent === "error" || finalEvent === "cancel") {
        return null;
    }
    if (!finalData || finalData === "null") {
        return null;
    }

    let parsed = null;
    try {
        parsed = JSON.parse(finalData);
    } catch (e) {
        return null;
    }
    if (!parsed || !parsed.length) {
        return null;
    }

    let file = parsed[0];
    if (!file) {
        return null;
    }

    let url = file.url;
    if (!url && file.path) {
        url = "/gradio_api/file=" + file.path;
    }
    if (!url) {
        return null;
    }
    // Bản tự host có thể trả đường dẫn tương đối.
    if (url.indexOf("http://") !== 0 && url.indexOf("https://") !== 0) {
        if (url.charAt(0) !== "/") {
            url = "/" + url;
        }
        url = BASE_URL + url;
    }
    return url;
}

function cleanText(text) {
    if (!text) {
        return "";
    }
    // Giữ nguyên dấu câu tiếng Việt (ZeroTTS dựa vào đó để ngắt nhịp);
    // chỉ bỏ ký tự vô hình và ký hiệu markup bị đọc thành tiếng lạ.
    let out = String(text)
        .replace(/[​-‏﻿]/g, "")
        .replace(/[“”‘’]/g, "")
        .replace(/[<>*_`~^|\\]/g, " ")
        .replace(/[【】\[\]{}()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (out.length > MAX_CHARS) {
        out = out.substring(0, MAX_CHARS);
    }
    return out;
}

function resolveVoice(voiceId) {
    for (let i = 0; i < voices.length; i++) {
        if (voices[i].id === voiceId) {
            return voices[i].id;
        }
    }
    return DEFAULT_VOICE;
}
