from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
qa = root / "qa"
font = ImageFont.load_default()


def fit(image, width, height):
    image = image.convert("RGB")
    scale = min(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "#06111c")
    canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return canvas


reference = fit(Image.open(qa / "reference.png"), 800, 500)
implementation = fit(Image.open(qa / "v04-main.png"), 800, 500)
comparison = Image.new("RGB", (1612, 544), "#06111c")
comparison.paste(reference, (0, 44))
comparison.paste(implementation, (812, 44))
draw = ImageDraw.Draw(comparison)
draw.text((16, 16), "REFERENCE", fill="#e8c977", font=font)
draw.text((828, 16), "VERSION 0.4.0", fill="#e8c977", font=font)
comparison.save(qa / "comparison-v0.4.png", quality=96)

focus_files = [
    ("v04-small-980x700.png", "SMALL WINDOW"),
    ("v04-settings.png", "SETTINGS"),
    ("v04-rule-multi.png", "MULTI-CONDITION ALERT"),
    ("v04-mini-compact.png", "MINI WINDOW"),
]
tile_w, tile_h, label_h = 620, 420, 36
sheet = Image.new("RGB", (tile_w * 2 + 12, (tile_h + label_h) * 2 + 12), "#06111c")
draw = ImageDraw.Draw(sheet)
for index, (filename, label) in enumerate(focus_files):
    x = (index % 2) * (tile_w + 12)
    y = (index // 2) * (tile_h + label_h + 12)
    draw.text((x + 12, y + 12), label, fill="#e8c977", font=font)
    sheet.paste(fit(Image.open(qa / filename), tile_w, tile_h), (x, y + label_h))
sheet.save(qa / "focused-v0.4.png", quality=96)
