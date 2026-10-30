#!/usr/bin/env python3
"""Build the App Router favicon set from the branded logo.

Crops the silver coupe (red stripe, no wordmark) out of public/logo.jpg.
Writes:
  app/icon.png        512×512
  app/apple-icon.png  180×180
  app/favicon.ico     16×16 and 32×32
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "public" / "logo.jpg"
APP = ROOT / "app"

# Square on the logo (1024×1536). Stops above the PANAMERICA wordmark.
CROP = (80, 400, 760, 1080)


def master() -> Image.Image:
    logo = Image.open(LOGO).convert("RGB")
    crop = logo.crop(CROP)
    if crop.size != (680, 680):
        raise SystemExit(f"unexpected crop {crop.size} from {logo.size}")
    return crop.resize((512, 512), Image.Resampling.LANCZOS)


def main() -> None:
    image = master()
    image.save(APP / "icon.png", format="PNG", optimize=True)
    image.resize((180, 180), Image.Resampling.LANCZOS).save(
        APP / "apple-icon.png", format="PNG", optimize=True
    )
    # Next.js rejects an ICO whose embedded PNGs are RGB. Keep an alpha channel.
    image.resize((32, 32), Image.Resampling.LANCZOS).convert("RGBA").save(
        APP / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32)],
    )


if __name__ == "__main__":
    main()
