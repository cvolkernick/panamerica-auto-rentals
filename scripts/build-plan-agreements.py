#!/usr/bin/env python3
"""Build labeled plan-agreement PDFs from data/agreements.json.

The JSON is the single source. Do not copy /plans marketing copy into the
PDFs. After replacing a stub with an owner-final PDF, set status to "final"
in the JSON and skip regenerating that file unless the owner asks.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "agreements.json"
OUT_DIR = ROOT / "public" / "plans"

PAGE_W = 612
PAGE_H = 792
MARGIN = 72
LEADING = 16
BODY_SIZE = 11
TITLE_SIZE = 18
WRAP = 86


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def wrap_text(text: str, width: int = WRAP) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current: list[str] = []
    n = 0
    for word in words:
        extra = len(word) + (1 if current else 0)
        if current and n + extra > width:
            lines.append(" ".join(current))
            current = [word]
            n = len(word)
        else:
            current.append(word)
            n += extra
    if current:
        lines.append(" ".join(current))
    return lines


def page_stream(lines: list[tuple[str, int, str]], page_index: int, page_count: int) -> bytes:
    """lines: (text, font_size, role) role in {title, banner, body, footer, meta}."""
    commands = ["BT"]
    y = PAGE_H - MARGIN
    first = True
    for text, size, role in lines:
        leading = 22 if role == "title" else 18 if role == "banner" else LEADING
        if first:
            commands.append(f"/F1 {size} Tf")
            commands.append(f"{MARGIN} {y} Td")
            first = False
        else:
            y -= leading
            commands.append(f"/F1 {size} Tf")
            commands.append(f"0 -{leading} Td")
        if role == "banner":
            commands.append("0.75 0.15 0.18 rg")
        elif role in ("footer", "meta"):
            commands.append("0.35 0.35 0.38 rg")
        else:
            commands.append("0 0 0 rg")
        commands.append(f"({pdf_escape(text)}) Tj")
    footer = (
        f"Page {page_index} of {page_count}  -  Panamerica Auto, LLC  -  not legal advice"
    )
    commands.append("ET")
    # Absolute footer via a second text object so it stays on the bottom margin.
    commands.append("BT")
    commands.append("/F1 9 Tf")
    commands.append("0.35 0.35 0.38 rg")
    commands.append(f"{MARGIN} 36 Td")
    commands.append(f"({pdf_escape(footer)}) Tj")
    commands.append("ET")
    return "\n".join(commands).encode("latin-1")


def paginate(doc: dict, banner: str, disclaimer: str) -> list[list[tuple[str, int, str]]]:
    header: list[tuple[str, int, str]] = [
        (doc["title"], TITLE_SIZE, "title"),
        (doc["subtitle"], 11, "meta"),
        ("Panamerica Auto, LLC  -  Florida LLC  -  L26000295877", 10, "meta"),
    ]
    if doc.get("status") != "final":
        for line in wrap_text(banner, 78):
            header.append((line, 10, "banner"))
    body: list[tuple[str, int, str]] = []
    for para in doc["paragraphs"]:
        wrapped = wrap_text(para)
        body.append(("", BODY_SIZE, "body"))
        for line in wrapped:
            body.append((line, BODY_SIZE, "body"))
    body.append(("", BODY_SIZE, "body"))
    for line in wrap_text(disclaimer, 84):
        body.append((line, 10, "footer"))

    # Keep ~36 body lines per page after the header.
    max_body = 32
    pages: list[list[tuple[str, int, str]]] = []
    remaining = body
    first = True
    while remaining or first:
        chunk = remaining[:max_body]
        remaining = remaining[max_body:]
        pages.append(header + chunk if first else [
            (f"{doc['title']} (continued)", 12, "title")
        ] + chunk)
        first = False
        if not remaining:
            break
    return pages


def build_pdf(pages: list[list[tuple[str, int, str]]]) -> bytes:
    streams = [page_stream(lines, i + 1, len(pages)) for i, lines in enumerate(pages)]
    objects: list[bytes] = []

    def add(obj: bytes) -> int:
        objects.append(obj)
        return len(objects)

    add(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{3 + i} 0 R" for i in range(len(pages)))
    add(f"<< /Type /Pages /Count {len(pages)} /Kids [{kids}] >>".encode("ascii"))
    content_ids = []
    for i, stream in enumerate(streams):
        add(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                f"/Resources << /Font << /F1 {3 + len(pages) * 2} 0 R >> >> "
                f"/Contents {3 + len(pages) + i} 0 R >>"
            ).encode("ascii")
        )
        content_ids.append(len(objects))
    for stream in streams:
        add(
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii")
            + stream
            + b"\nendstream"
        )
    add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{i} 0 obj\n".encode("ascii"))
        out.extend(obj)
        out.extend(b"\nendobj\n")
    xref_at = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    out.extend(
        (
            f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_at}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(out)


def main() -> int:
    payload = json.loads(DATA.read_text())
    banner = payload["draftBanner"]
    disclaimer = payload["disclaimer"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    expected = {
        "spotlight",
        "standard-management",
        "guaranteed-payment",
        "owner-exit",
    }
    slugs = {doc["slug"] for doc in payload["documents"]}
    if slugs != expected:
        print(f"slug mismatch: {sorted(slugs)} != {sorted(expected)}", file=sys.stderr)
        return 1
    for doc in payload["documents"]:
        if doc.get("pdfSource") == "owner":
            print(f"skip public/plans/{doc['pdfFile']} (owner-supplied PDF)")
            continue
        pages = paginate(doc, banner, disclaimer)
        pdf = build_pdf(pages)
        dest = OUT_DIR / doc["pdfFile"]
        dest.write_bytes(pdf)
        digest = hashlib.sha256(pdf).hexdigest()
        print(f"{dest.relative_to(ROOT)}  {len(pdf)}  sha256 {digest[:16]}")
        if not pdf.startswith(b"%PDF-"):
            print("invalid PDF header", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
