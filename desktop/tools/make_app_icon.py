"""Builds the program icon (clubdesk/resources/app.ico and app.png) from the club logo.

    pip install pillow
    python desktop/tools/make_app_icon.py

The black drone of public/assets/images/logo_ntut.jpg is drawn in white on a
navy rounded square, so it stays readable at 16 px on the taskbar and title bar.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public" / "assets" / "images" / "logo_ntut.jpg"
OUT = ROOT / "desktop" / "clubdesk" / "resources"
SIZE = 512


def build() -> Image.Image:
    logo = ImageOps.grayscale(Image.open(SOURCE))
    mask = logo.point(lambda v: 255 if v < 128 else 0)  # the dark drone shape
    mask = mask.crop(mask.getbbox())
    scale = SIZE * 0.80 / max(mask.size)
    mask = mask.resize((round(mask.width * scale), round(mask.height * scale)), Image.LANCZOS)

    # Navy-to-blue vertical gradient in a rounded square, like a 2010-era app icon.
    top, bottom = (31, 78, 154), (10, 36, 106)
    gradient = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(gradient)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        draw.line([(0, y), (SIZE, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    shape = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(shape).rounded_rectangle([8, 8, SIZE - 9, SIZE - 9], radius=96, fill=255)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(gradient, (0, 0), shape)
    # Glossy highlight on the upper half.
    gloss = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(gloss).ellipse([-SIZE // 2, -SIZE * 3 // 4, SIZE * 3 // 2, SIZE // 2], fill=40)
    gloss = ImageChops.multiply(gloss, shape)
    icon.paste(Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255)), (0, 0), gloss)
    # Drone with a soft shadow.
    x, y = (SIZE - mask.width) // 2, (SIZE - mask.height) // 2 + 6
    shadow = Image.new("L", (SIZE, SIZE), 0)
    shadow.paste(mask, (x + 6, y + 8))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8)).point(lambda v: v * 0.55)
    icon.paste(Image.new("RGBA", (SIZE, SIZE), (0, 0, 40, 255)), (0, 0), ImageChops.multiply(shadow, shape))
    icon.paste(Image.new("RGBA", mask.size, (255, 255, 255, 255)), (x, y), mask)
    return icon


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = build()
    icon.resize((256, 256), Image.LANCZOS).save(OUT / "app.png")
    icon.save(OUT / "app.ico", sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote", OUT / "app.ico", "and app.png")


if __name__ == "__main__":
    main()
