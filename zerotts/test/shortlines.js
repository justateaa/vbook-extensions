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
    "   ",
    // App cắt câu ngay tại dấu ba chấm giữa dòng, nên sinh ra đoạn KẾT THÚC
    // bằng "…" và đoạn kế BẮT ĐẦU bằng "…", thường kèm ngoặc kép lẻ một bên.
    "“Thôi được…",
    "…tôi sẽ đi phía sau”",
    "…",
    "…… ",
    "Ừ…",
    "…Ừ",
    "“…”",
    "-",
    "—",
    "1.",
    "A",
    // Dấu gạch đầu dòng là cách đánh dấu thoại/tượng thanh rất phổ biến.
    "-Ầm!",
    "- Ầm!",
    "—Ầm!",
    "– Ầm!",
    "-Ầm",
    "!",
    "!!!",
    "-",
    "-…",
    "Ầm!"
];

// Ngưỡng độ dài tối thiểu mỗi clip. Player nối liền của vBook gãy ở clip quá
// ngắn — đo được nó dừng hẳn tại các clip 0,5-1,0s, clip 1,4s thì vẫn chạy.
// Backend chèn im lặng cho đủ ZEROTTS_MIN_SEC; đây là chốt để không trôi lại.
const MIN_SEC = 1.5;
let tooShort = 0;

// MP3 ở đây là CBR: độ dài ~= số byte dữ liệu * 8 / bitrate, bitrate đọc từ
// frame header đầu tiên.
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
function mp3Seconds(buf) {
    let start = 0;
    if (buf.slice(0, 3).toString() === "ID3") {
        start = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 |
                      (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
    }
    for (let j = start; j < buf.length - 4; j++) {
        if (buf[j] !== 0xff || (buf[j + 1] & 0xe0) !== 0xe0) continue;
        const kbps = BITRATES[(buf[j + 2] >> 4) & 0x0f];
        if (!kbps) continue;
        return (buf.length - start) * 8 / (kbps * 1000);
    }
    return null;
}

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
        const sec = mp3Seconds(buf);
        const shortClip = sec !== null && sec < MIN_SEC;
        if (shortClip) tooShort++;
        verdict = (shortClip ? "NGẮN" : "OK  ") + " " + buf.length + "B " +
            (isMp3 ? "MP3" : "WAV") + "  " +
            (sec === null ? "?" : sec.toFixed(1) + "s");
    } else {
        verdict = "ERROR: " + r.message;
        hardFail++;
    }
    console.log(
        JSON.stringify(line).padEnd(24) + " | " +
        JSON.stringify(cleaned).padEnd(17) + " | " + verdict
    );
}

console.log("\nSố dòng làm execute() trả lỗi : " + hardFail + "/" + LINES.length);
console.log("Số clip ngắn hơn " + MIN_SEC + "s        : " + tooShort + "/" + LINES.length);
console.log("\nCả hai phải bằng 0. Trả lỗi thì vBook dừng phát cả chương; clip quá");
console.log("ngắn thì player nối liền gãy — cùng triệu chứng, hai nguyên nhân khác.");
if (hardFail || tooShort) process.exitCode = 1;
for (const f of ["_b.bin", "_req.json"]) {
    try { fs.unlinkSync(path.join(__dirname, f)); } catch (e) {}
}
