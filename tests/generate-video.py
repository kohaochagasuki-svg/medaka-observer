"""Generate a deterministic, synthetic 3-minute fixture; no real fish / personal data."""
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw

out = Path(__file__).parent / 'fixtures'
out.mkdir(exist_ok=True)
target = out / 'five-fish-3min.mp4'
command = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '320x180', '-r', '10', '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)]
process = subprocess.Popen(command, stdin=subprocess.PIPE)
for frame in range(1800):
    image = Image.new('RGB', (320, 180), (200, 205, 200))
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 15, 15, 166), fill=(75, 75, 75))  # Static equipment.
    for fish in range(5):
        phase = (frame / 10 + fish * 1.4) % 30
        x = 40 + (phase if phase < 15 else 30 - phase) * 16
        y = 23 + fish * 30
        draw.ellipse((x - 8, y - 3, x + 8, y + 3), fill=(40, 45, 40))
        tail = -1 if phase < 15 else 1
        draw.polygon([(x + tail * 6, y), (x + tail * 13, y - 3), (x + tail * 13, y + 3)], fill=(40, 45, 40))
    bubble_y = 170 - (frame * 0.8) % 155
    draw.ellipse((303, bubble_y - 2, 307, bubble_y + 2), fill=(90, 95, 90))
    process.stdin.write(image.tobytes())
process.stdin.close()
if process.wait():
    raise SystemExit('ffmpeg failed')
print('Synthetic fixture:', target, '(180s, five separate candidates, 30 positive + 30 negative crossings)')
