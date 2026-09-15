// Chạy execute() thật của extension trên các câu NGẮN.
// Chỗ app dừng đọc là một dòng thoại rất ngắn trong ngoặc kép, nên nghi ngờ
// nằm ở đường đi của câu ngắn: cleanText có thể làm rỗng, và chốt chặn
// base64.length < 1000 vốn viết cho WAV thô có thể bắt nhầm khi backend đã
// đổi sang MP3 (MP3 của câu ngắn nhỏ hơn WAV cùng câu khoảng 5 lần).
//
//   node test/shortlines.js <base-url>
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const vm = require("vm");

const BASE = process.argv[2] || "http://127.0.0.1:7860";

function vbookFetch(url, opts) {
    opts = opts || {};
    const bodyFile = path.join(__dirname, "_b.bin");
    const args = ["-sSL", "-o", bodyFile, "-w", "%{http_code}"];
    if (opts.method) args.push("-X", opts.method);
    for (const k in opts.headers || {}) args.push("-H", k + ": " + opts.headers[k]);
    if (opts.body) {
        const reqFile = path.join(__dirname, "_req.json");
        fs.writeFileSync(reqFile, Buffer.from(opts.body, "utf8"));
        args.push("--data-binary", "@" + reqFile);
    }
    args.push("--max-time", String(Math.ceil((opts.timeout || 30000) / 1000)), url);
    const code = parseInt(execFileSync("curl", args, { encoding: "utf8" }).trim(), 10);
    const buf = fs.readFileSync(bodyFile);
    return {
        status: code, ok: code >= 200 && code < 300, url: url,
        text: function () { return buf.toString("utf8"); },
        json: function () { return JSON.parse(buf.toString("utf8")); },
        base64: function () { return buf.toString("base64"); }
    };
}

const sandbox = {
    fetch: vbookFetch, console: console,
    Response: {
        success: function (d) { return { ok: true, data: d }; },
        error: function (m) { return { ok: false, message: m }; }
    },
    load: function () {},
    ZEROTTS_URL: BASE
};
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/voice_list.js"), "utf8") + "\n" +
    fs.readFileSync(path.join(__dirname, "../src/tts.js"), "utf8").replace(/^load\(.*$/m, ""),
    sandbox);

// Dạng dòng hay gặp trong truyện dịch, từ dài tới cực ngắn, cộng các dòng chỉ
// toàn dấu câu mà cleanText có thể xoá sạch thành chuỗi rỗng.
const LINES = [
    "Sau khi tìm thấy ghi chú, cô ấy đã trở nên rất hợp tác.",
    "“Anh có đang nghe không vậy?”",
    "“À, ừ”",
    "“Ừ”",
    "Ừ.",
    "?",
    "…",
    "“……”",
    "“”",
    "()",
    "[]",
    "   "
];

console.log("execute() trên câu ngắn  ->  " + BASE + "\n");
console.log("input                    | sau cleanText     | kết quả");
console.log("-------------------------+-------------------+---------------------------");

let hardFail = 0;
for (const line of LINES) {
    const cleaned = sandbox.cleanText(line);
    const r = sandbox.execute(line, "giahuy");
    let verdict;
    if (r.ok) {
        const buf = Buffer.from(r.data, "base64");
        const isMp3 = buf.slice(0, 3).toString() === "ID3" ||
            (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
        verdict = "OK  " + buf.length + "B " + (isMp3 ? "MP3" : "WAV") +
            "  base64=" + r.data.length;
    } else {
        verdict = "ERROR: " + r.message;
        hardFail++;
    }
    console.log(
        JSON.stringify(line).padEnd(24) + " | " +
        JSON.stringify(cleaned).padEnd(17) + " | " + verdict
    );
}

console.log("\nSố dòng làm execute() trả Response.error: " + hardFail + "/" + LINES.length);
console.log("Mỗi dòng như vậy là một câu app không nhận được audio.");
for (const f of ["_b.bin", "_req.json"]) {
    try { fs.unlinkSync(path.join(__dirname, f)); } catch (e) {}
}
