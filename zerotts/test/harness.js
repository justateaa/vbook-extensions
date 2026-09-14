// Harness kiểm thử: chạy src/tts.js trong môi trường giả lập Rhino của vBook.
// fetch() của vBook là đồng bộ -> giả lập bằng curl qua execFileSync.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const vm = require("vm");

function vbookFetch(url, opts) {
    opts = opts || {};
    const hdrFile = path.join(__dirname, "_h.txt");
    const bodyFile = path.join(__dirname, "_b.bin");
    const args = ["-sSL", "-D", hdrFile, "-o", bodyFile, "-w", "%{http_code}"];
    if (opts.method) args.push("-X", opts.method);
    for (const k in opts.headers || {}) args.push("-H", k + ": " + opts.headers[k]);
    // Body phải đi qua file: argv trên Windows làm hỏng UTF-8 tiếng Việt.
    if (opts.body) {
        const reqFile = path.join(__dirname, "_req.json");
        fs.writeFileSync(reqFile, Buffer.from(opts.body, "utf8"));
        args.push("--data-binary", "@" + reqFile);
    }
    args.push("--max-time", String(Math.ceil((opts.timeout || 30000) / 1000)));
    args.push(url);

    const code = parseInt(execFileSync("curl", args, { encoding: "utf8" }).trim(), 10);
    const buf = fs.readFileSync(bodyFile);
    return {
        status: code,
        ok: code >= 200 && code < 300,
        url: url,
        text: function () { return buf.toString("utf8"); },
        json: function () { return JSON.parse(buf.toString("utf8")); },
        base64: function () { return buf.toString("base64"); }
    };
}

const results = [];
const sandbox = {
    fetch: vbookFetch,
    console: console,
    Response: {
        success: function (d) { return { ok: true, data: d }; },
        error: function (m) { return { ok: false, message: m }; }
    },
    load: function () {},
    // Giả lập config injection của app (const KEY = "...").
    ZEROTTS_URL: process.env.ZT_URL || "https://hugging-apps-zerotts-vietnamese-demo.hf.space",
    ZEROTTS_CFG_SCALE: "1.0",
    ZEROTTS_TEMPERATURE: "0.8"
};
vm.createContext(sandbox);

// load() không phải lời gọi thật — app nối file lại. Mô phỏng bằng cách nối nguồn.
const voiceList = fs.readFileSync(path.join(__dirname, "../src/voice_list.js"), "utf8");
const ttsSrc = fs.readFileSync(path.join(__dirname, "../src/tts.js"), "utf8")
    .replace(/^load\(.*$/m, "");
vm.runInContext(voiceList + "\n" + ttsSrc, sandbox);

// let/const ở top-level là lexical binding, không thành thuộc tính của sandbox.
const BASE_URL = vm.runInContext("BASE_URL", sandbox);

function check(name, cond, extra) {
    results.push((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  " + extra : ""));
}

// 1. Parser SSE — không cần mạng.
const parse = sandbox.parseAudioUrl;
check("SSE complete -> url",
    parse('event: complete\ndata: [{"path":"/tmp/a.wav","url":"https://h.co/f=/tmp/a.wav"},"ok"]\n')
        === "https://h.co/f=/tmp/a.wav");
check("SSE error -> null",
    parse('event: error\ndata: {"msg":"boom"}\n') === null);
check("url tương đối -> tuyệt đối",
    parse('event: complete\ndata: [{"path":"/tmp/a.wav","url":"/gradio_api/file=/tmp/a.wav"},"ok"]\n')
        === BASE_URL + "/gradio_api/file=/tmp/a.wav");
check("thiếu url, có path",
    parse('event: complete\ndata: [{"path":"/tmp/a.wav"},"ok"]\n')
        === BASE_URL + "/gradio_api/file=/tmp/a.wav");
check("data null -> null", parse('event: complete\ndata: null\n') === null);
check("body rỗng -> null", parse("") === null);
check("JSON hỏng -> null", parse('event: complete\ndata: [not json\n') === null);
check("CRLF", parse('event: complete\r\ndata: [{"url":"https://h.co/a.wav"},"ok"]\r\n')
    === "https://h.co/a.wav");

// 2. cleanText / resolveVoice.
const clean = sandbox.cleanText;
check("giữ dấu câu + dấu tiếng Việt",
    clean("Hắn nói: “đi thôi”, rồi quay đi.") === "Hắn nói: đi thôi, rồi quay đi.",
    JSON.stringify(clean("Hắn nói: “đi thôi”, rồi quay đi.")));
check("bỏ markup", clean("**đậm** _nghiêng_ [x]") === "đậm nghiêng x",
    JSON.stringify(clean("**đậm** _nghiêng_ [x]")));
check("cắt trần 1000", clean("a".repeat(1500)).length === 1000);
check("rỗng -> ''", clean("   ") === "" && clean(null) === "");
check("voice hợp lệ", sandbox.resolveVoice("giahuy") === "giahuy");
check("voice lạ -> maichi", sandbox.resolveVoice("khongcogiongnay") === "maichi");

// 3. Chạy thật qua backend.
if (process.env.ZT_LIVE === "1") {
    const t0 = Date.now();
    const r = sandbox.execute("Xin chào các bạn, đây là bản thử ZeroTTS trên vBook.", "giahuy");
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    check("execute() live", r.ok === true, r.ok ? "" : r.message);
    if (r.ok) {
        const wav = Buffer.from(r.data, "base64");
        check("base64 giải ra WAV",
            wav.slice(0, 4).toString() === "RIFF" && wav.slice(8, 12).toString() === "WAVE",
            wav.length + " bytes, " + dt + "s");
    }
    const bad = sandbox.execute("   ", "maichi");
    check("văn bản rỗng -> error", bad.ok === false, bad.message);
}

for (const line of results) console.log(line);
console.log("\n" + results.filter(function (r) { return r.indexOf("PASS") === 0; }).length +
    "/" + results.length + " pass");
process.exit(results.some(function (r) { return r.indexOf("FAIL") === 0; }) ? 1 : 0);
