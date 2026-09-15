#!/usr/bin/env python3
"""Đóng gói extension thành plugin.zip và dựng lại file index plugin.json ở root.

vBook nạp repo qua file index ở root: metadata + data[], mỗi mục trỏ tới một
plugin.zip. Bên trong zip phải phẳng — plugin.json, icon.png, src/ nằm ngay gốc,
không bọc thêm thư mục.

Chạy: python build.py
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
RAW = "https://raw.githubusercontent.com/justateaa/vbook-extensions/main"

# Thư mục extension sẽ được publish. google-tts cố tình không có ở đây:
# tác giả là vBook, không phải của repo này.
EXTENSIONS = ["zerotts"]

# docker/ và test/ là đồ nghề phát triển, app không cần -> không nhét vào zip.
PACK_DIRS = ["src"]
PACK_FILES = ["plugin.json", "icon.png"]


def build_zip(ext: str) -> dict:
    src = ROOT / ext
    meta = json.loads((src / "plugin.json").read_text(encoding="utf-8"))["metadata"]

    # EXT_VERSION nhúng trong tts.js phải khớp metadata.version, không thì backend
    # log sai bản đang chạy và lại mất một vòng hỏi đi hỏi lại.
    tts = (src / "src" / "tts.js")
    if tts.exists():
        import re as _re
        m = _re.search(r'const EXT_VERSION = "([^"]+)"', tts.read_text(encoding="utf-8"))
        if m and m.group(1) != str(meta["version"]):
            raise SystemExit(
                f"{ext}: EXT_VERSION={m.group(1)} nhưng plugin.json version={meta['version']}"
            )

    out = src / "plugin.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in PACK_FILES:
            f = src / name
            if f.exists():
                z.write(f, name)
        for d in PACK_DIRS:
            for f in sorted((src / d).rglob("*")):
                if f.is_file():
                    z.write(f, str(f.relative_to(src)).replace("\\", "/"))

    with zipfile.ZipFile(out) as z:
        print(f"{ext}/plugin.zip  {out.stat().st_size} bytes  {z.namelist()}")

    return {
        "name": ext,
        "author": meta["author"],
        "path": f"{RAW}/{ext}/plugin.zip",
        "version": meta["version"],
        "source": meta["source"],
        "icon": f"{RAW}/{ext}/icon.png",
        "description": meta["description"],
        "type": meta["type"],
        "locale": meta.get("locale", "vi"),
    }


def main() -> None:
    index = {
        "metadata": {
            "author": "justateaa",
            "description": "Extension TTS cho vBook",
        },
        "data": [build_zip(e) for e in EXTENSIONS],
    }
    (ROOT / "plugin.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nplugin.json (index): {len(index['data'])} extension")


if __name__ == "__main__":
    main()
