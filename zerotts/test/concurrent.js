// Đo hàng đợi Gradio khi bị bắn đồng thời.
// app.py đặt default_concurrency_limit=1, còn vBook có thread_num (mặc định 3).
// Nếu app bắn 3 request cùng lúc, 2 cái phải nằm chờ. Câu hỏi: thời gian chờ có
// phình dần qua từng vòng không — vì phình không giới hạn thì cuối cùng sẽ vượt
// timeout của app và mọi đoạn đều hỏng, tức là im hẳn.
//
//   node test/concurrent.js <base-url> [số vòng] [số request mỗi vòng]
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = (process.argv[2] || "http://127.0.0.1:7860").replace(/\/+$/, "");
const ROUNDS = parseInt(process.argv[3] || "5", 10);
const PAR = parseInt(process.argv[4] || "3", 10);
const TMP = path.join(__dirname, "_cc");
fs.mkdirSync(TMP, { recursive: true });

const TEXT = "Trời vừa hửng sáng, hắn đã thu xếp hành lý rồi lặng lẽ rời khỏi thôn, không từ biệt một ai.";
const REQ = path.join(TMP, "req.json");
fs.writeFileSync(REQ, Buffer.from(JSON.stringify({ text: TEXT, voice: "giahuy" }), "utf8"));

function sh(args) {
    return new Promise(function (resolve) {
        const p = spawn("curl", args, { encoding: "utf8" });
        let out = "";
        p.stdout.on("data", function (d) { out += d; });
        p.stderr.on("data", function () {});
        p.on("close", function () { resolve(out); });
    });
}

async function one(tag) {
    const t0 = Date.now();
    const submit = await sh(["-sS", "-X", "POST", BASE + "/gradio_api/call/v2/synthesize",
        "-H", "Content-Type: application/json", "--data-binary", "@" + REQ, "--max-time", "60"]);
    let id = null;
    try { id = JSON.parse(submit).event_id; } catch (e) {}
    if (!id) return { tag, fail: "submit: " + submit.slice(0, 80) };

    const sse = await sh(["-sSN", BASE + "/gradio_api/call/synthesize/" + id, "--max-time", "600"]);
    const total = (Date.now() - t0) / 1000;

    const line = sse.split("\n").filter(function (l) { return l.indexOf("data:") === 0; }).pop();
    if (!line) return { tag, total, fail: "SSE không có data (" + sse.length + "B)" };
    const m = /RTF ([0-9.]+)x/.exec(sse);
    const ok = line.indexOf('"url"') !== -1;
    return { tag, total, engineRtf: m ? m[1] : "?", fail: ok ? null : "không có url" };
}

(async function () {
    console.log("bắn " + PAR + " request đồng thời × " + ROUNDS + " vòng  ->  " + BASE + "\n");
    console.log("vòng | chậm nhất | nhanh nhất | engine RTF | hỏng");
    console.log("-----+-----------+------------+------------+-----");
    let prevMax = null;
    for (let r = 1; r <= ROUNDS; r++) {
        const jobs = [];
        for (let k = 0; k < PAR; k++) jobs.push(one(r + "." + k));
        const res = await Promise.all(jobs);
        const good = res.filter(function (x) { return !x.fail; });
        const times = good.map(function (x) { return x.total; });
        const max = times.length ? Math.max.apply(null, times) : 0;
        const min = times.length ? Math.min.apply(null, times) : 0;
        const rtfs = good.map(function (x) { return x.engineRtf; }).join("/");
        console.log(
            String(r).padEnd(5) + "|" +
            (max.toFixed(1) + "s").padStart(10) + " |" +
            (min.toFixed(1) + "s").padStart(11) + " |" +
            rtfs.padStart(11) + " |" +
            String(res.length - good.length).padStart(4)
        );
        res.filter(function (x) { return x.fail; })
           .forEach(function (x) { console.log("      HỎNG " + x.tag + ": " + x.fail); });
        prevMax = max;
    }
    console.log("\nChờ phình dần qua các vòng = hàng đợi dồn lại -> sẽ vượt timeout -> im hẳn.");
    console.log("Chờ ổn định = hàng đợi không dồn, phải tìm nguyên nhân khác.");
    fs.rmSync(TMP, { recursive: true, force: true });
})();
