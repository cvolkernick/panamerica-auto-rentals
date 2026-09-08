#!/usr/bin/env python3
"""Compose public/og.jpg (1200×630) from the branded logo."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "public" / "logo.jpg"
OUT = ROOT / "public" / "og.jpg"

NAVY = (7, 11, 22)
GOLD = (227, 179, 65)
WHITE = (255, 255, 255)
MUTED = (183, 192, 212)
RED = (225, 29, 46)

WIDTH, HEIGHT = 1200, 630
TAGLINE = (
    "Fleet management and automotive logistics, "
    "specializing in management of assets on Turo "
    "and other rideshare platforms."
)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else f"{current} {word}"
        if draw.textlength(trial, font=fnt) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def main() -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), NAVY)
    logo = Image.open(LOGO).convert("RGB")

    target_h = HEIGHT - 40
    scale = target_h / logo.height
    logo_w = int(logo.width * scale)
    logo_h = target_h
    logo = logo.resize((logo_w, logo_h), Image.Resampling.LANCZOS)
    canvas.paste(logo, (20, 20))

    draw = ImageDraw.Draw(canvas)
    rule_x = 20 + logo_w + 28
    draw.rectangle((rule_x, 48, rule_x + 4, HEIGHT - 48), fill=RED)

    text_x = rule_x + 36
    text_max = WIDTH - text_x - 48

    heading = font("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf", 92)
    sub = font("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf", 42)
    body = font("/System/Library/Fonts/Supplemental/Arial.ttf", 26)

    y = 88
    draw.text((text_x, y), "PANAMERICA", font=heading, fill=WHITE)
    y += 86
    draw.text((text_x, y), "AUTO RENTALS", font=sub, fill=GOLD)
    y += 64
    draw.rectangle((text_x, y, text_x + 120, y + 3), fill=GOLD)
    y += 28

    for line in wrap(draw, TAGLINE, body, text_max):
        draw.text((text_x, y), line, font=body, fill=MUTED)
        y += 36

    canvas.save(OUT, format="JPEG", quality=92, optimize=True, progressive=True)
    print(f"wrote {OUT} {canvas.size[0]}x{canvas.size[1]}")


if __name__ == "__main__":
    main()
