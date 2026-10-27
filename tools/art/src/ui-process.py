# Post-processes the generated interface art (art/ui/*.png from ui.ts) for the client: resizes
# to the sizes the UI uses (trimming transparent margins where asked) and writes WebP files to
# packages/client/public/ui/. Run with the art venv's Python (Pillow).
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / 'art/ui'
OUT = ROOT / 'packages/client/public/ui'

# name: (longest side in px, trim transparent margins)
SIZES = {
    'keyart': (1600, False), 'loading': (1600, False), 'logo': (384, True), 'compassLines': (640, True),
    # The fantasy UI kit (border images and decorations).
    'woodFrame': (512, True), 'woodPlaque': (900, True), 'woodButton': (640, True), 'woodButtonOn': (640, True),
    'woodSlot': (192, True), 'woodBanner': (360, True), 'woodCrest': (384, True),
}


def main(names: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (size, trim) in SIZES.items():
        if names and name not in names:
            continue
        src = SRC / f'{name}.png'
        if not src.exists():
            print(f'missing {src}')
            continue
        im = Image.open(src).convert('RGBA')
        if trim:
            box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
            if box:
                im = im.crop(box)
        im.thumbnail((size, size), Image.LANCZOS)
        if trim:
            im.save(OUT / f'{name}.webp', 'WEBP', quality=88, method=6)
        else:
            im.convert('RGB').save(OUT / f'{name}.webp', 'WEBP', quality=82, method=6)
        print(name, im.size)


if __name__ == '__main__':
    main(sys.argv[1:])
