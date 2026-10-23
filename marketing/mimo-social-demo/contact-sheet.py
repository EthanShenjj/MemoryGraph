from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).parent
output = root / "output"

def build(pattern, columns, cell, name):
    files = sorted(output.glob(pattern))
    thumb_w, thumb_h = cell
    rows = (len(files) + columns - 1) // columns
    canvas = Image.new("RGB", (columns * thumb_w, rows * thumb_h), "#e9e9e6")
    for index, file in enumerate(files):
        image = Image.open(file).convert("RGB")
        image.thumbnail((thumb_w - 28, thumb_h - 56), Image.Resampling.LANCZOS)
        x = (index % columns) * thumb_w + (thumb_w - image.width) // 2
        y = (index // columns) * thumb_h + 18
        canvas.paste(image, (x, y))
        ImageDraw.Draw(canvas).text((x, y + image.height + 8), file.stem, fill="#333333")
    canvas.save(output / name)

build("xhs-*.png", 3, (390, 560), "preview-xhs.png")
build("x-*.png", 2, (650, 410), "preview-x.png")
