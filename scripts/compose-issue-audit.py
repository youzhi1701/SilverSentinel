from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

root = Path(r"C:\Users\YH\Documents\Codex\2026-09-08\wo\outputs\gold-monitor-desktop")
out = root / "qa" / "audit-0.4.1"
out.mkdir(parents=True, exist_ok=True)

sources = [
    (Path(r"C:\Users\YH\AppData\Local\Temp\codex-clipboard-8aa8d3b7-90bc-49ea-ade8-47004b3722a4.png"), out / "01-ai-before.png"),
    (root / "qa" / "v041-ai-settings.png", out / "02-ai-after.png"),
    (Path(r"C:\Users\YH\AppData\Local\Temp\codex-clipboard-ef0d1df3-1e58-46ea-9d61-586303f4ee15.png"), out / "03-chart-before.png"),
    (root / "qa" / "v041-chart-5s.png", out / "04-chart-after.png"),
]

font = None
for candidate in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
    try:
        font = ImageFont.truetype(candidate, 24)
        break
    except OSError:
        pass
font = font or ImageFont.load_default()

for index, (src, dst) in enumerate(sources):
    image = Image.open(src).convert("RGB")
    if index == 0:
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((38, 678, 365, 716), radius=6, fill="#071927", outline="#f6c65b", width=2)
        draw.text((50, 683), "API Key 已遮挡，请立即更换", fill="#f6c65b", font=font)
    image.save(dst, quality=95)

target_w, target_h = 750, 500
cells = []
for _, path in sources:
    image = Image.open(path).convert("RGB")
    image.thumbnail((target_w, target_h - 44), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (target_w, target_h), "#071927")
    x = (target_w - image.width) // 2
    y = 44 + (target_h - 44 - image.height) // 2
    canvas.paste(image, (x, y))
    cells.append(canvas)

for canvas, label in zip(cells, ("AI 修复前", "AI 修复后", "K线修复前", "K线修复后")):
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, target_w, 43), fill="#0d2638")
    box = draw.textbbox((0, 0), label, font=font)
    draw.text(((target_w - (box[2] - box[0])) / 2, 8), label, fill="#f6c65b", font=font)

sheet = Image.new("RGB", (target_w * 2 + 12, target_h * 2 + 12), "#d5a841")
sheet.paste(cells[0], (0, 0))
sheet.paste(cells[1], (target_w + 12, 0))
sheet.paste(cells[2], (0, target_h + 12))
sheet.paste(cells[3], (target_w + 12, target_h + 12))
sheet.save(out / "comparison.png", quality=96)
print(out / "comparison.png")
