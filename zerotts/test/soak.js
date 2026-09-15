// Soak test: mô phỏng app đọc truyện liên tục qua backend.
// Gửi tuần tự từng đoạn ~max_length ký tự, đo độ trễ mỗi chặng, so với độ dài
// audio tạo ra. Mục đích là bắt hiện tượng "đọc một lúc rồi im" — nếu độ trễ
// tăng dần hoặc treo, số liệu ở đây sẽ chỉ ra chặng nào phình.
//
//   node test/soak.js <base-url> [số đoạn]
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = (process.argv[2] || "http://127.0.0.1:7860").replace(/\/+$/, "");
const N = parseInt(process.argv[3] || "12", 10);
const TMP = path.join(__dirname, "_soak");
fs.mkdirSync(TMP, { recursive: true });

// Đoạn ~120 ký tự, đúng max_length trong plugin.json.
const CHUNKS = [
    "Trời vừa hửng sáng, hắn đã thu xếp hành lý rồi lặng lẽ rời khỏi thôn, không từ biệt một ai trong nhà.",
    "Gió sớm thổi qua rặng tre, lạnh buốt tới tận xương, nhưng bước chân hắn vẫn không hề chậm lại một nhịp nào.",
    "Con đường mòn dẫn ra khỏi làng phủ đầy sương trắng, mỗi bước đi đều để lại một dấu chân ướt sẫm phía sau.",
    "Hắn dừng lại bên gốc đa đầu làng, ngoái đầu nhìn lại lần cuối, rồi quay đi không một lần ngoảnh lại nữa."
];

// LONG=<n> gộp n câu thành một đoạn, để đo overhead cố định mỗi đoạn được
// chia đều trên bao nhiêu giây audio.
const GROUP = parseInt(process.env.LONG || "1", 10);
if (GROUP > 1) {
    const merged = [];
    for (let i = 0; i < CHUNKS.length; i++) {
        const parts = [];
        for (let j = 0; j < GROUP; j++) parts.push(CHUNKS[(i + j) % CHUNKS.length]);
        merged.push(parts.join(" "));
    }
    CHUNKS.length = 0;
    for (const m of merged) CHUNKS.push(m);
}

function curl(args) {
    return execFileSync("curl", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function synth(text, i) {
    const t0 = Date.now();
    const req = path.join(TMP, "req.json");
    fs.writeFileSync(req, Buffer.from(JSON.stringify({ text: text, voice: "giahuy" }), "utf8"));

    const submitRaw = curl(["-sS", "-X", "POST", BASE + "/gradio_api/call/v2/synthesize",
        "-H", "Content-Type: application/json", "--data-binary", "@" + req,
        "--max-time", "60"]);
    const tSubmit = Date.now() - t0;

    let eventId;
    try {
        eventId = JSON.parse(submitRaw).event_id;
    } catch (e) {
        return { i, fail: "submit không phải JSON: " + submitRaw.slice(0, 120) };
    }
    if (!eventId) return { i, fail: "không có event_id: " + submitRaw.slice(0, 120) };

    const t1 = Date.now();
    const sse = curl(["-sSN", BASE + "/gradio_api/call/synthesize/" + eventId, "--max-time", "300"]);
    const tSse = Date.now() - t1;

    const lines = sse.split("\n").filter(function (l) { return l.indexOf("data:") === 0; });
    if (!lines.length) return { i, fail: "SSE không có data, dài " + sse.length + "B" };
    let payload;
    try {
        payload = JSON.parse(lines[lines.length - 1].slice(5).trim());
    } catch (e) {
        return { i, fail: "data không parse được" };
    }
    if (!payload || !payload[0] || !payload[0].url) {
        return { i, fail: "không có url: " + JSON.stringify(payload).slice(0, 160) };
    }

    const t2 = Date.now();
    const out = path.join(TMP, "a.wav");
    curl(["-sSL", "-o", out, payload[0].url, "--max-time", "120"]);
    const tDl = Date.now() - t2;

    const bytes = fs.statSync(out).size;
    const audioSec = (bytes - 44) / (48000 * 2); // 48 kHz mono 16-bit
    const totalSec = (Date.now() - t0) / 1000;

    return {
        i, tSubmit, tSse, tDl, bytes, audioSec, totalSec,
        rtf: totalSec / audioSec,
        detail: String(payload[1] || "").slice(0, 60)
    };
}

console.log("soak " + BASE + "  " + N + " đoạn\n");
console.log("#    submit    sse     tải   audio   tổng    RTF   trạng thái");

let playable = 0, spent = 0, fails = 0;
for (let i = 1; i <= N; i++) {
    let r;
    try {
        r = synth(CHUNKS[(i - 1) % CHUNKS.length], i);
    } catch (e) {
        r = { i, fail: e.message.split("\n")[0].slice(0, 100) };
    }
    if (r.fail) {
        fails++;
        console.log(String(i).padEnd(5) + "HỎNG  " + r.fail);
        continue;
    }
    playable += r.audioSec;
    spent += r.totalSec;
    console.log(
        String(r.i).padEnd(5) +
        (r.tSubmit + "ms").padStart(7) +
        (r.tSse + "ms").padStart(8) +
        (r.tDl + "ms").padStart(7) +
        (r.audioSec.toFixed(1) + "s").padStart(7) +
        (r.totalSec.toFixed(1) + "s").padStart(7) +
        r.rtf.toFixed(2).padStart(7) + "   " +
        (r.rtf < 1 ? "kịp" : "CHẬM HƠN NGHE")
    );
}

console.log("\ntổng audio tạo ra : " + playable.toFixed(1) + "s");
console.log("tổng thời gian    : " + spent.toFixed(1) + "s");
console.log("RTF trung bình    : " + (spent / playable).toFixed(2) +
    (spent / playable < 1 ? "  (tích được đệm)" : "  (đệm cạn dần -> sẽ im tiếng)"));
console.log("số đoạn hỏng      : " + fails + "/" + N);
fs.rmSync(TMP, { recursive: true, force: true });
