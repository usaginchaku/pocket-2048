"""Regenerate the original, local-only application icons (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
BACKGROUND = "#f8f6f0"
INK = "#263c36"
GREEN = "#41745d"


def generate(size: int, name: str) -> None:
    # Render at 4x before downsampling for clean text at iPhone icon sizes.
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGB", (canvas_size, canvas_size), BACKGROUND)
    draw = ImageDraw.Draw(image)
    unit = canvas_size / 512
    draw.rounded_rectangle(
        (76 * unit, 76 * unit, 436 * unit, 436 * unit),
        radius=76 * unit,
        fill=GREEN,
    )
    font = ImageFont.truetype(str(FONT), round(106 * unit))
    text = "2048"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(
        ((canvas_size - (right - left)) / 2 - left,
         (canvas_size - (bottom - top)) / 2 - top),
        text,
        fill=BACKGROUND,
        font=font,
    )
    image.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)


for dimension, filename in [
    (180, "apple-touch-icon.png"),
    (192, "icon-192.png"),
    (512, "icon-512.png"),
]:
    generate(dimension, filename)
