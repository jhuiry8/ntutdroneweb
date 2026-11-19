"""Generates all mobile and PWA icons for NTUT Drone Club from the official logo.

Usage:
    python tools/make_mobile_icons.py
"""

from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "assets" / "images" / "logo_ntut.jpg"
ICONS_DIR = ROOT / "public" / "assets" / "icons"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
SIZE = 512


def build_base_icon(maskable: bool = False) -> Image.Image:
    """Builds a high resolution 512x512 base icon."""
    logo = ImageOps.grayscale(Image.open(SOURCE))
    # Extract the dark drone shape
    mask = logo.point(lambda v: 255 if v < 128 else 0)
    mask = mask.crop(mask.getbbox())

    # For maskable icons, the safe zone is inner 80% circle
    scale_factor = 0.60 if maskable else 0.78
    scale = SIZE * scale_factor / max(mask.size)
    mask = mask.resize((round(mask.width * scale), round(mask.height * scale)), Image.LANCZOS)

    # Gradient background: Modern deep dark tech theme (#0b0f19 to #1e293b)
    top, bottom = (26, 42, 74), (11, 15, 25)
    gradient = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(gradient)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        draw.line(
            [(0, y), (SIZE, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,),
        )

    if maskable:
        # Full bleed for maskable icon
        icon = gradient
    else:
        # Rounded square for standard icon
        shape = Image.new("L", (SIZE, SIZE), 0)
        ImageDraw.Draw(shape).rounded_rectangle([12, 12, SIZE - 13, SIZE - 13], radius=110, fill=255)
        icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        icon.paste(gradient, (0, 0), shape)

    # Accent cyan / blue glow ring
    glow_color = (59, 130, 246, 70)  # blue glow
    glow_draw = ImageDraw.Draw(icon)
    if not maskable:
        glow_draw.rounded_rectangle([14, 14, SIZE - 15, SIZE - 15], radius=108, outline=glow_color, width=4)

    # Drone shadow
    x, y = (SIZE - mask.width) // 2, (SIZE - mask.height) // 2 + 4
    shadow = Image.new("L", (SIZE, SIZE), 0)
    shadow.paste(mask, (x + 4, y + 6))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10)).point(lambda v: v * 0.6)
    icon.paste(Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255)), (0, 0), shadow)

    # Drone emblem in pure white
    icon.paste(Image.new("RGBA", mask.size, (255, 255, 255, 255)), (x, y), mask)

    return icon


def make_round(im: Image.Image) -> Image.Image:
    """Masks an image into a circle for Android round launcher."""
    size = im.size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size[0], size[1]), fill=255)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    base = build_base_icon(maskable=False)
    maskable_base = build_base_icon(maskable=True)

    pwa_sizes = [72, 96, 128, 144, 152, 192, 384, 512]
    for s in pwa_sizes:
        base.resize((s, s), Image.LANCZOS).save(ICONS_DIR / f"icon-{s}x{s}.png")
        print(f"Generated {ICONS_DIR / f'icon-{s}x{s}.png'}")

    # Apple touch icon (180x180)
    base.resize((180, 180), Image.LANCZOS).save(ICONS_DIR / "apple-touch-icon.png")
    # Also save to public root for default Apple Safari lookup
    base.resize((180, 180), Image.LANCZOS).save(ROOT / "public" / "apple-touch-icon.png")

    # Maskable 512
    maskable_base.save(ICONS_DIR / "maskable-icon-512x512.png")
    print(f"Generated {ICONS_DIR / 'maskable-icon-512x512.png'}")

    # Android mipmaps
    android_densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }

    for dir_name, size in android_densities.items():
        out_dir = ANDROID_RES / dir_name
        out_dir.mkdir(parents=True, exist_ok=True)
        img = base.resize((size, size), Image.LANCZOS)
        img.save(out_dir / "ic_launcher.png")
        round_img = make_round(img)
        round_img.save(out_dir / "ic_launcher_round.png")
        print(f"Generated Android icon in {out_dir} ({size}x{size})")

    print("All mobile icons generated successfully!")


if __name__ == "__main__":
    main()
