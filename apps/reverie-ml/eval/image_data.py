"""Synthetic images for the image eval, drawn with Pillow: nothing is fetched and nothing is licensed.

Each image has an English and a Finnish caption. The shapes are easy for a vision model, so absolute scores are
optimistic compared with real photos; the set is for comparing candidates and picking a starting similarity floor.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageDraw

SIZE = 384
# colour: (rgb, English, Finnish nominative, Finnish adessive for "on a ... background")
COLOURS = {
    "red": ((220, 30, 30), "red", "punainen", "punaisella"),
    "blue": ((30, 70, 220), "blue", "sininen", "sinisellä"),
    "green": ((30, 160, 60), "green", "vihreä", "vihreällä"),
    "yellow": ((240, 210, 30), "yellow", "keltainen", "keltaisella"),
    "white": ((245, 245, 245), "white", "valkoinen", "valkoisella"),
}
SHAPES = {"circle": ("circle", "ympyrä"), "square": ("square", "neliö"), "triangle": ("triangle", "kolmio")}


@dataclass(frozen=True)
class EvalImage:
    key: str
    png: bytes
    en: str
    fi: str


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _shape_image(shape: str, colour: str, background: str) -> Image.Image:
    image = Image.new("RGB", (SIZE, SIZE), COLOURS[background][0])
    draw = ImageDraw.Draw(image)
    fill = COLOURS[colour][0]
    box = (SIZE // 4, SIZE // 4, SIZE * 3 // 4, SIZE * 3 // 4)
    if shape == "circle":
        draw.ellipse(box, fill=fill)
    elif shape == "square":
        draw.rectangle(box, fill=fill)
    else:
        draw.polygon([(SIZE // 2, SIZE // 5), (SIZE // 5, SIZE * 4 // 5), (SIZE * 4 // 5, SIZE * 4 // 5)], fill=fill)
    return image


def _shape_images() -> list[EvalImage]:
    images = []
    for shape, (shape_en, shape_fi) in SHAPES.items():
        for colour, (_, colour_en, colour_fi, _) in COLOURS.items():
            for background, (_, bg_en, _, bg_adessive) in COLOURS.items():
                if colour == background:
                    continue
                images.append(
                    EvalImage(
                        key=f"{colour}-{shape}-on-{background}",
                        png=_png(_shape_image(shape, colour, background)),
                        en=f"a {colour_en} {shape_en} on a {bg_en} background",
                        fi=f"{colour_fi} {shape_fi} {bg_adessive} taustalla",
                    )
                )
    return images


def _scene_images() -> list[EvalImage]:
    scenes = []

    sea = Image.new("RGB", (SIZE, SIZE), (135, 200, 240))
    draw = ImageDraw.Draw(sea)
    draw.rectangle((0, SIZE // 2, SIZE, SIZE), fill=(20, 80, 190))
    draw.ellipse((SIZE // 2 - 50, SIZE // 4 - 50, SIZE // 2 + 50, SIZE // 4 + 50), fill=(250, 220, 40))
    scenes.append(EvalImage("sun-sea", _png(sea), "a yellow sun above the blue sea", "keltainen aurinko sinisen meren yläpuolella"))

    night = Image.new("RGB", (SIZE, SIZE), (10, 10, 40))
    draw = ImageDraw.Draw(night)
    draw.ellipse((SIZE // 2 - 45, SIZE // 3 - 45, SIZE // 2 + 45, SIZE // 3 + 45), fill=(240, 240, 220))
    for x, y in [(40, 60), (300, 40), (90, 200), (330, 220), (200, 280)]:
        draw.ellipse((x, y, x + 4, y + 4), fill=(255, 255, 255))
    scenes.append(EvalImage("moon-night", _png(night), "a pale moon in a dark night sky with stars", "vaalea kuu tummalla yötaivaalla tähtien kanssa"))

    hill = Image.new("RGB", (SIZE, SIZE), (130, 195, 245))
    draw = ImageDraw.Draw(hill)
    draw.ellipse((-100, SIZE // 2, SIZE + 100, SIZE + 300), fill=(40, 150, 60))
    scenes.append(EvalImage("green-hill", _png(hill), "a green hill under a clear blue sky", "vihreä kumpu kirkkaan sinisen taivaan alla"))

    house = Image.new("RGB", (SIZE, SIZE), (130, 195, 245))
    draw = ImageDraw.Draw(house)
    draw.rectangle((0, SIZE * 3 // 4, SIZE, SIZE), fill=(40, 150, 60))
    draw.rectangle((110, 190, 270, SIZE * 3 // 4), fill=(190, 40, 40))
    draw.polygon([(90, 190), (SIZE // 2, 90), (290, 190)], fill=(70, 40, 30))
    scenes.append(EvalImage("red-house", _png(house), "a small red house with a brown roof on green grass", "pieni punainen talo ruskealla katolla vihreällä nurmella"))

    stripes = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    draw = ImageDraw.Draw(stripes)
    for x in range(0, SIZE, 48):
        draw.rectangle((x, 0, x + 24, SIZE), fill=(0, 0, 0))
    scenes.append(EvalImage("stripes", _png(stripes), "black and white vertical stripes", "mustavalkoiset pystyraidat"))

    return scenes


def build_images() -> list[EvalImage]:
    return _shape_images() + _scene_images()
