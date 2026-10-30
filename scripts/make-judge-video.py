"""Judge video: title cards + the live screen recording (live-assets/demo.mp4) with burned-in captions.
Usage: python3 scripts/make-judge-video.py [out.mp4]. Needs ffmpeg and the Inter font."""
import subprocess, sys, tempfile, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "live-assets", "judge-video.mp4")
FONT = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
W, H, FPS = 1280, 800, 25
BG, ACCENT = "0x18202c", "0x7c95ff"

def esc(t):
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")

def card(path, secs, lines):
    """lines: (text, size, weight, color, y)"""
    draws = ",".join(
        f"drawtext=fontfile={FONT.format(w)}:text='{esc(t)}':fontsize={s}:fontcolor={c}:x=(w-text_w)/2:y={y}:alpha='min(1,t/0.5)'"
        for t, s, w, c, y in lines)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:r={FPS}:d={secs}",
                    "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo", "-t", str(secs),
                    "-vf", draws, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path], check=True)

CAPTIONS = [  # (start, end, text) over the 64 s recording
    (0.5, 4, "A real café plan, written in Japanese: Gen Z who love golf, The Godfather and Taylor Swift."),
    (4, 8, "Paste the target-customer paragraph, in any language."),
    (8, 12.5, "The agent extracts the persona, then asks Qloo who really likes these things."),
    (12.5, 17, "Score 49: probably a wish, not a customer."),
    (17, 24, "Every red flag cites the Qloo number behind it: weak overlap, an assumption that doesn't hold."),
    (24, 31, "Qloo's audience data: these interests attract people aged 25-34, not 24 and under."),
    (31, 36, "...and shows the persona these interests really describe, with brands they over-index on."),
    (36, 41, "Now a plan that holds up: hikers 35-44 who own Snow Peak, Patagonia and The North Face."),
    (41, 48, "Score 79. The brands the plan assumes, Arc'teryx and MUJI, fit this cluster."),
    (48, 56, "Interest pairs overlap strongly, and the age chart matches the plan."),
    (56, 64, "\"What the agent did\" lists every Qloo call: search, tags, demographics, affinities, recommendations."),
]

def captioned(src, path):
    boxes = ",".join(
        f"drawtext=fontfile={FONT.format('SemiBold')}:text='{esc(t)}':fontsize=26:fontcolor=white:box=1:boxcolor=0x18202cE6:boxborderw=16"
        f":x=(w-text_w)/2:y=h-90:enable='between(t,{a},{b})'" for a, b, t in CAPTIONS)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                    "-vf", f"scale={W}:{H},fps={FPS},{boxes}", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path], check=True)

with tempfile.TemporaryDirectory() as d:
    parts = [os.path.join(d, f"{i}.mp4") for i in range(5)]
    card(parts[0], 5, [("Persona Reality Check", 64, "Bold", "white", 300),
                       ("Is the customer in your business plan real?", 34, "Medium", ACCENT, 400),
                       ("An agent that checks it against Qloo Taste AI", 26, "Regular", "0xb8c1d9", 460)])
    card(parts[1], 7, [("Every business plan has a target customer.", 38, "SemiBold", "white", 290),
                       ("Advisors read hundreds of them. Nobody checks them.", 38, "SemiBold", "white", 345),
                       ("So plans go ahead with a customer who barely exists.", 30, "Regular", ACCENT, 430)])
    captioned(os.path.join(ROOT, "live-assets", "demo.mp4"), parts[2])
    card(parts[3], 8, [("How it works", 44, "Bold", "white", 190),
                       ("1. Read the plan and extract age, gender, place, interests, assumed brands", 26, "Regular", "white", 290),
                       ("2. Qloo /search and /v2/tags resolve every name", 26, "Regular", "white", 340),
                       ("3. Qloo demographics: who each interest's audience really is", 26, "Regular", "white", 390),
                       ("4. Qloo affinities: do the interests and assumed brands share fans?", 26, "Regular", "white", 440),
                       ("5. Score, red/amber/green findings and a reviewer memo with one fix", 26, "Regular", "white", 490),
                       ("Every number comes from Qloo. Calibrated on six known personas.", 26, "Medium", ACCENT, 580)])
    card(parts[4], 6, [("Try it: persona-reality-check.onrender.com", 38, "Bold", "white", 320),
                       ("github.com/KEIOKUTANI/persona-reality-check  (AGPL-3.0)", 28, "Regular", ACCENT, 390),
                       ("Qloo results describe aggregate taste patterns, not individuals.", 22, "Regular", "0xb8c1d9", 470)])
    lst = os.path.join(d, "list.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", OUT], check=True)
print(OUT)
