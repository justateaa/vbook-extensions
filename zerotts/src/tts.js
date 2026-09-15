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

// Khoảng lặng 0,34 giây. Thông số PHẢI khớp clip giọng mà backend trả về:
// MP3 48 kHz mono 64 kbps. Bản đầu dùng 24 kHz 32 kbps và app đọc được một
// lúc rồi gãy — hàng phát nối liền của vBook không nuốt được cú đổi sample
// rate giữa chừng. Dựng bằng:
//   ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 0.3 -b:a 64k -ac 1 out.mp3
// Truyện dịch đầy dòng chỉ có dấu ba chấm hoặc ngoặc kép trống; ZeroTTS không
// sinh ra âm nào cho chúng, mà trả Response.error thì vBook dừng phát cả
// chương không báo gì. Trả khoảng lặng để app đi tiếp câu sau.
const SILENT_MP3 = "SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/+1TAAAAAAAAAAAAAAAAAAAAAAABJbmZvAAAADwAAAA4AAAtAACIiIiIiIiIzMzMzMzMzRERERERERFVVVVVVVVVmZmZmZmZmd3d3d3d3d4iIiIiIiIiZmZmZmZmZmaqqqqqqqqq7u7u7u7u7zMzMzMzMzN3d3d3d3d3u7u7u7u7u/////////wAAAABMYXZjNjEuMTkAAAAAAAAAAAAAAAAkBIAAAAAAAAALQP/8JPUAAAAAAAAAAAAAAAAAAAD/+1TEAAPAAAGkAAAAIAAANIAAAARMQUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEVYPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1TEqgPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";

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
    if (!hasSpeech(payload)) {
        return Response.success(SILENT_MP3);
    }

    // Bước 1 - đẩy job vào hàng đợi Gradio, nhận event_id.
    let submit = fetch(BASE_URL + "/gradio_api/call/v2/synthesize", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
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
        return Response.error("ZeroTTS: gửi yêu cầu thất bại (HTTP " + submit.status + ")");
    }

    let eventId = null;
    try {
        eventId = submit.json().event_id;
    } catch (e) {
        return Response.error("ZeroTTS: phản hồi submit không phải JSON");
    }
    if (!eventId) {
        return Response.error("ZeroTTS: không nhận được event_id");
    }

    // Bước 2 - đọc stream SSE cho tới khi job xong, rút URL file WAV.
    let stream = fetch(BASE_URL + "/gradio_api/call/synthesize/" + eventId, {
        headers: {"Accept": "text/event-stream"},
        timeout: RENDER_TIMEOUT
    });
    if (!stream.ok) {
        return Response.error("ZeroTTS: đọc kết quả thất bại (HTTP " + stream.status + ")");
    }

    let fileUrl = parseAudioUrl(stream.text());
    if (!fileUrl) {
        // Gọi được backend nhưng nó không sinh ra audio nào. Gặp với các dòng
        // toàn dấu câu lọt qua hasSpeech. Đừng chặn cả chương vì một dòng.
        return Response.success(SILENT_MP3);
    }

    // Bước 3 - tải WAV rồi trả base64 cho app.
    let audio = fetch(fileUrl, {timeout: DOWNLOAD_TIMEOUT});
    if (!audio.ok) {
        return Response.error("ZeroTTS: tải audio thất bại (HTTP " + audio.status + ")");
    }

    let base64 = audio.base64();
    // Ngưỡng cũ 1000 viết cho WAV thô; MP3 của một câu ngắn nhỏ hơn nhiều
    // (tiếng "Ừ" chỉ 4 KB), nên hạ xuống kẻo bắt nhầm audio hợp lệ.
    if (!base64 || base64.length < 100) {
        return Response.success(SILENT_MP3);
    }
    return Response.success(base64);
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

// Có gì để đọc thành tiếng không: bỏ hết dấu câu, ký hiệu và khoảng trắng,
// còn lại chữ hoặc số thì mới đáng gọi backend.
function hasSpeech(s) {
    if (!s) {
        return false;
    }
    return s.replace(/[\s.,;:!?…"'`~@#$%^&*+=\/\|<>(){}\[\]«»„“”‘’\-–—_]/g, "").length > 0;
}

function resolveVoice(voiceId) {
    for (let i = 0; i < voices.length; i++) {
        if (voices[i].id === voiceId) {
            return voices[i].id;
        }
    }
    return DEFAULT_VOICE;
}
