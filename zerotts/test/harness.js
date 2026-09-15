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

const VOICE_LIST = fs.readFileSync(path.join(__dirname, "../src/voice_list.js"), "utf8");
// load() không phải lời gọi thật — app nối file lại. Mô phỏng bằng cách nối nguồn.
const TTS_SRC = fs.readFileSync(path.join(__dirname, "../src/tts.js"), "utf8")
    .replace(/^load\(.*$/m, "");

// Nạp extension với một bộ config injection cụ thể.
// Trả { sandbox, baseUrl, loadError } — loadError khác null nghĩa là script chết
// lúc load, tức execute() không tồn tại và app sẽ treo mà không báo gì.
function loadExt(config) {
    const sandbox = {
        fetch: vbookFetch,
        console: console,
        Response: {
            success: function (d) { return { ok: true, data: d }; },
            error: function (m) { return { ok: false, message: m }; }
        },
        load: function () {}
    };
    Object.assign(sandbox, config || {});
    vm.createContext(sandbox);
    try {
        vm.runInContext(VOICE_LIST + "\n" + TTS_SRC, sandbox);
    } catch (e) {
        return { sandbox: sandbox, baseUrl: null, loadError: e };
    }
    // let/const ở top-level là lexical binding, không thành thuộc tính của sandbox.
    return { sandbox: sandbox, baseUrl: vm.runInContext("BASE_URL", sandbox), loadError: null };
}

const DEFAULT_SPACE = "https://hugging-apps-zerotts-vietnamese-demo.hf.space";
const results = [];

function check(name, cond, extra) {
    results.push((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  " + extra : ""));
}

// ── 1. Config injection ─────────────────────────────────────────────────────
// Tài liệu nói config luôn là chuỗi, nhưng bản vBook thật không phải lúc nào
// cũng vậy. Ảnh chụp máy người dùng cho thấy config dạng object bị app đọc
// thành 0 -> giá trị inject vào JS cũng không còn là chuỗi. Script PHẢI sống sót
// mọi kiểu, vì chết lúc load là app treo im lặng, không có thông báo lỗi nào.
const INJECTIONS = [
    ["chuỗi bình thường", { ZEROTTS_URL: "https://abc.example.com" }, "https://abc.example.com"],
    ["thiếu scheme", { ZEROTTS_URL: "192.168.1.10:7860" }, "http://192.168.1.10:7860"],
    ["thừa dấu /", { ZEROTTS_URL: "https://abc.example.com///" }, "https://abc.example.com"],
    ["không inject gì", {}, DEFAULT_SPACE],
    ["chuỗi rỗng", { ZEROTTS_URL: "" }, DEFAULT_SPACE],
    ["chỉ khoảng trắng", { ZEROTTS_URL: "   " }, DEFAULT_SPACE],
    ["object (config dạng object)", { ZEROTTS_URL: { title: "x", default: "https://y.com" } }, DEFAULT_SPACE],
    ["số", { ZEROTTS_URL: 7860 }, DEFAULT_SPACE],
    ["null", { ZEROTTS_URL: null }, DEFAULT_SPACE],
    ["true", { ZEROTTS_URL: true }, DEFAULT_SPACE]
];

for (const [label, cfg, expected] of INJECTIONS) {
    const r = loadExt(cfg);
    if (r.loadError) {
        check("ZEROTTS_URL " + label, false, "SCRIPT CHẾT LÚC LOAD: " + r.loadError.message);
    } else {
        check("ZEROTTS_URL " + label, r.baseUrl === expected,
            r.baseUrl === expected ? "" : "-> " + JSON.stringify(r.baseUrl));
    }
}

// Tham số số học cũng phải chịu được object/rác mà không làm chết script.
const numeric = loadExt({
    ZEROTTS_URL: "https://abc.example.com",
    ZEROTTS_CFG_SCALE: { default: "2.0" },
    ZEROTTS_TEMPERATURE: "rác"
});
check("tham số số học là rác -> vẫn load", numeric.loadError === null,
    numeric.loadError ? numeric.loadError.message : "");

// ── 2. Parser SSE ───────────────────────────────────────────────────────────
const ext = loadExt({ ZEROTTS_URL: process.env.ZT_URL || DEFAULT_SPACE });
if (ext.loadError) {
    console.log("FAIL  không nạp nổi extension: " + ext.loadError.message);
    process.exit(1);
}
const { sandbox, baseUrl } = ext;
const parse = sandbox.parseAudioUrl;

check("SSE complete -> url",
    parse('event: complete\ndata: [{"path":"/tmp/a.wav","url":"https://h.co/f=/tmp/a.wav"},"ok"]\n')
        === "https://h.co/f=/tmp/a.wav");
check("SSE error -> null", parse('event: error\ndata: {"msg":"boom"}\n') === null);
check("url tương đối -> tuyệt đối",
    parse('event: complete\ndata: [{"path":"/tmp/a.wav","url":"/gradio_api/file=/tmp/a.wav"},"ok"]\n')
        === baseUrl + "/gradio_api/file=/tmp/a.wav");
check("thiếu url, có path",
    parse('event: complete\ndata: [{"path":"/tmp/a.wav"},"ok"]\n')
        === baseUrl + "/gradio_api/file=/tmp/a.wav");
check("data null -> null", parse('event: complete\ndata: null\n') === null);
check("body rỗng -> null", parse("") === null);
check("JSON hỏng -> null", parse('event: complete\ndata: [not json\n') === null);
check("CRLF", parse('event: complete\r\ndata: [{"url":"https://h.co/a.wav"},"ok"]\r\n')
    === "https://h.co/a.wav");

// ── 3. cleanText / resolveVoice ─────────────────────────────────────────────
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

// ── 4. Chạy thật qua backend ────────────────────────────────────────────────
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
const pass = results.filter(function (r) { return r.indexOf("PASS") === 0; }).length;
console.log("\n" + pass + "/" + results.length + " pass");
process.exit(pass === results.length ? 0 : 1);
