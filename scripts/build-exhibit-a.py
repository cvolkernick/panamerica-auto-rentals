#!/usr/bin/env python3
"""Regenerate public/plans/exhibit-a-vehicle-schedule.pdf.

There is no earlier source file for this schedule. This script is the source.
Vehicle-schedule labels, order, and blanks stay as they were. The plan block
is Fleet Management only: the rung checkboxes, Spotlight tiers, and Owner Exit
fields are not written.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "plans" / "exhibit-a-vehicle-schedule.pdf"

PAGE_W = 612
PAGE_H = 792
MARGIN_X = 54
MARGIN_TOP = 54
MARGIN_BOTTOM = 54
LEADING = 14

# WinAnsi bytes for glyphs Helvetica does not take as Latin-1 Unicode.
WINANSI = {
    "\u2014": 0x97,  # em dash
    "\u2013": 0x96,  # en dash
    "\u2022": 0x95,  # bullet
}


def winansi(text: str) -> bytes:
    raw = bytearray()
    for char in text:
        if char in WINANSI:
            raw.append(WINANSI[char])
        else:
            raw.extend(char.encode("latin-1"))
    return bytes(raw).replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def wrap(text: str, width: int) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current: list[str] = []
    count = 0
    for word in words:
        extra = len(word) + (1 if current else 0)
        if current and count + extra > width:
            lines.append(" ".join(current))
            current = [word]
            count = len(word)
        else:
            current.append(word)
            count += extra
    if current:
        lines.append(" ".join(current))
    return lines


# (text, size, role, wrap width). role: banner, title, body, bullet, section, footer, gap
BLOCKS: list[tuple[str, int, str]] = [
    (
        "DRAFT — pending owner approval and legal counsel review. Not legal advice.",
        10,
        "banner",
    ),
    ("", 11, "gap"),
    ("EXHIBIT A — Vehicle Schedule (template)", 16, "title"),
    ("", 8, "gap"),
    (
        "Attach one completed copy per vehicle to the applicable plan agreement. The agreement it attaches to is identified below.",
        11,
        "body",
    ),
    ("", 8, "gap"),
    ("Plan: Fleet Management", 12, "section"),
    (
        "Commission by trip length: 20% (trips under 7 days), 15% (7–21 days), 10% (over 21 days).",
        11,
        "body",
    ),
    ("First month: half commission — 10% / 7.5% / 5%.", 11, "body"),
    ("", 8, "gap"),
    ("Owner", 13, "section"),
    ("Full name: ___________________________", 11, "bullet"),
    ("Phone: ___________________________", 11, "bullet"),
    ("Email: ___________________________", 11, "bullet"),
    ("Mailing address: ___________________________", 11, "bullet"),
    ("", 8, "gap"),
    ("Vehicle", 13, "section"),
    ("Year / Make / Model: ___________________________", 11, "bullet"),
    (
        "Model year (management plans: 12 model years old or newer at enrollment): ___________________________",
        11,
        "bullet",
    ),
    ("VIN: ___________________________", 11, "bullet"),
    ("License plate / state: ___________________________", 11, "bullet"),
    (
        "Odometer at enrollment (management plans: under 130,000 miles): ___________________________",
        11,
        "bullet",
    ),
    ("Color: ___________________________", 11, "bullet"),
    ("", 8, "gap"),
    ("Plan details", 13, "section"),
    ("Monthly car payment amount: $__________", 11, "bullet"),
    ("Monthly insurance premium: $__________", 11, "bullet"),
    ("Lender / lienholder name: ___________________________", 11, "bullet"),
    ("Loan account (last 4): ___________________________", 11, "bullet"),
    ("Insurance carrier: ___________________________", 11, "bullet"),
    ("Policy number: ___________________________", 11, "bullet"),
    ("Policy period: ___________________________", 11, "bullet"),
    ("", 8, "gap"),
    ("Term", 13, "section"),
    ("Start date: ___________________________", 11, "bullet"),
    (
        "Term: month-to-month from the start date for all plans, with no initial or minimum term; either party may terminate by written notice, effective at the end of the calendar month following the month in which notice is given",
        11,
        "bullet",
    ),
    ("", 8, "gap"),
    ("Acknowledgment", 13, "section"),
    (
        "Owner confirms the information above is accurate and that any lien on the Vehicle is disclosed here. Owner agrees to notify Company promptly of changes to payment amounts, insurance, or contact details.",
        11,
        "body",
    ),
    ("", 10, "break"),
    ("Owner", 12, "section"),
    ("", 4, "gap"),
    ("Signature: ___________________________ Name:", 11, "body"),
    ("___________________________ Date: __________", 11, "body"),
    ("", 10, "gap"),
    ("Panamerica Auto, LLC", 12, "section"),
    ("", 4, "gap"),
    ("Signature: ___________________________ Name / Title:", 11, "body"),
    ("___________________________ Date: __________", 11, "body"),
    ("", 16, "gap"),
    ("Panamerica Auto, LLC — DRAFT", 10, "footer"),
]


def expand() -> list[tuple[str, int, str]]:
    lines: list[tuple[str, int, str]] = []
    for text, size, role in BLOCKS:
        if role == "break":
            lines.append(("", size, "break"))
            continue
        if role == "gap" or text == "":
            lines.append(("", size, "gap"))
            continue
        width = 78 if size >= 13 else 86 if size <= 10 else 82
        wrapped = wrap(text, width)
        for index, line in enumerate(wrapped):
            if role == "bullet" and index == 0:
                lines.append((f"\u2022  {line}", size, "bullet"))
            elif role == "bullet":
                lines.append((f"    {line}", size, "body"))
            else:
                lines.append((line, size, role))
    return lines


def paginate(lines: list[tuple[str, int, str]]) -> list[list[tuple[str, int, str]]]:
    pages: list[list[tuple[str, int, str]]] = []
    current: list[tuple[str, int, str]] = []
    y = PAGE_H - MARGIN_TOP
    for line in lines:
        size = line[1]
        if line[2] == "break":
            if current:
                pages.append(current)
                current = []
                y = PAGE_H - MARGIN_TOP
            continue
        step = size + 4 if line[2] != "gap" else max(size, 6)
        if y - step < MARGIN_BOTTOM and current:
            pages.append(current)
            current = []
            y = PAGE_H - MARGIN_TOP
        current.append(line)
        y -= step
    if current:
        pages.append(current)
    return pages


def page_stream(lines: list[tuple[str, int, str]]) -> bytes:
    commands = ["BT", f"{MARGIN_X} {PAGE_H - MARGIN_TOP} Td"]
    first = True
    for text, size, role in lines:
        step = size + 4 if role != "gap" else max(size, 6)
        if first:
            commands.append(f"/F1 {size} Tf")
            first = False
        else:
            commands.append(f"0 -{step} Td")
            commands.append(f"/F1 {size} Tf")
        if role == "banner":
            commands.append("0.75 0.15 0.18 rg")
        elif role == "footer":
            commands.append("0.35 0.35 0.38 rg")
        else:
            commands.append("0 0 0 rg")
        if text:
            commands.append(f"({winansi(text).decode('latin-1')}) Tj")
    commands.append("ET")
    return "\n".join(commands).encode("latin-1")


def build_pdf(pages: list[list[tuple[str, int, str]]]) -> bytes:
    streams = [page_stream(page) for page in pages]
    objects: list[bytes] = []

    def add(obj: bytes) -> None:
        objects.append(obj)

    font_id = 3 + len(pages) * 2
    add(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{3 + i} 0 R" for i in range(len(pages)))
    add(f"<< /Type /Pages /Count {len(pages)} /Kids [{kids}] >>".encode("ascii"))
    for i, stream in enumerate(streams):
        add(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                f"/Resources << /Font << /F1 {font_id} 0 R >> >> "
                f"/Contents {3 + len(pages) + i} 0 R >>"
            ).encode("ascii")
        )
    for stream in streams:
        add(f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream")
    add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )

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
            f"trailer << /Size {len(objects) + 1} /Root 1 0 R "
            f"/Info << /Title (Exhibit A - Vehicle Schedule (DRAFT)) >> >>\n"
            f"startxref\n{xref_at}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(out)


def main() -> int:
    pages = paginate(expand())
    pdf = build_pdf(pages)
    if not pdf.startswith(b"%PDF-"):
        print("invalid PDF header", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(pdf)
    print(f"{OUT.relative_to(ROOT)}  {len(pdf)} bytes  {len(pages)} page(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
