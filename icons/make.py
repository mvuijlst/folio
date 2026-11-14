"""Cuts the app's icons out of the artwork (icons/folio-art.jpg). Needs Pillow:

    server/venv/Scripts/python.exe icons/make.py

The artwork is a book in a dark disc on an indigo ground. The round icons are that disc;
the square ones (for launchers that cut their own shape, and for iOS) continue the disc's
colour to the edges, so no ring shows whatever the shape.
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
CENTRE = (1000, 558)   # of the disc, in the artwork
DISC = 392             # px: just inside the disc's edge; the book and the three marks reach 370
INK = (34, 28, 76)     # the disc's own colour, #221c4c

art = Image.open(HERE / 'folio-art.jpg').convert('RGB')


def disc(side):
    """The artwork, `side` px around the centre, see-through outside the disc."""
    half = side // 2
    box = (CENTRE[0] - half, CENTRE[1] - half, CENTRE[0] + half, CENTRE[1] + half)
    cut = art.crop(box).convert('RGBA')
    big = 4   # the mask is drawn larger and scaled down, for a smooth edge
    mask = Image.new('L', (side * big, side * big), 0)
    ImageDraw.Draw(mask).ellipse([(half - DISC) * big, (half - DISC) * big, (half + DISC) * big, (half + DISC) * big], fill=255)
    cut.putalpha(mask.resize((side, side), Image.LANCZOS))
    return cut


def round_icon(size):
    return disc(DISC * 2).resize((size, size), Image.LANCZOS)


def square_icon(size, side):
    """`side`: how much of the artwork's width the square spans; the book stays inside the
    middle 80% (the safe zone of a maskable icon) from 925 up."""
    ground = Image.new('RGBA', (side, side), INK + (255,))
    ground.alpha_composite(disc(side))
    return ground.convert('RGB').resize((size, size), Image.LANCZOS)


round_icon(512).save(HERE / 'icon-512.png', optimize=True)
round_icon(192).save(HERE / 'icon-192.png', optimize=True)
round_icon(96).save(HERE / 'mark-96.png', optimize=True)        # beside the name in the app
round_icon(48).save(HERE / 'favicon-48.png', optimize=True)
square_icon(512, 960).save(HERE / 'maskable-512.png', optimize=True)
square_icon(180, 880).save(HERE / 'apple-touch-icon.png', optimize=True)
for name in ('icon-512', 'icon-192', 'mark-96', 'favicon-48', 'maskable-512', 'apple-touch-icon'):
    print(name, (HERE / f'{name}.png').stat().st_size)
