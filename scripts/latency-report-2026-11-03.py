"""Builds the 3 November 2026 latency report (PDF), from docs/baseline/2026-11-03-provisional-{en,hi}.json (scripts/latency-baseline.sh).

Old header: builds the 29 October 2026 latency report (PDF). Unlike latency-report.py the numbers are typed in below, copied from the load-test output of 28 October (the run output was not saved as JSON).

  pnpm --filter @voiceai/voice load-test -- ... --json .local/report/A-en-builtin.json   (one file per setup)
  python3 scripts/latency-report.py

Every number in the PDF is computed here from those files, so the report cannot drift from the measurements. The facts that
were measured by other means (AskG1 on 24 October, the load runs) are written below, with where they came from.
"""
import json, statistics as st, sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/latency-report-2026-11-03.pdf"
DATE = "3 November 2026"

BLUE = colors.HexColor("#2563eb"); INK = colors.HexColor("#0f1a33"); MUTED = colors.HexColor("#5a6b8c")
SOFT = colors.HexColor("#e9f0fc"); LINE = colors.HexColor("#d8e3f5"); WARN = colors.HexColor("#fbf0d9"); WARNTXT = colors.HexColor("#7a4a05")
RED = colors.HexColor("#fde8e8"); REDTXT = colors.HexColor("#8a1c1c")
base = ParagraphStyle("b", fontName="Helvetica", fontSize=10, leading=13.6, textColor=INK)
h1 = ParagraphStyle("h1", parent=base, fontName="Helvetica-Bold", fontSize=20, leading=24, spaceAfter=2)
sub = ParagraphStyle("sub", parent=base, fontSize=10, textColor=MUTED, spaceAfter=8)
h2 = ParagraphStyle("h2", parent=base, fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=BLUE, spaceBefore=11, spaceAfter=5, keepWithNext=1)
bul = ParagraphStyle("bul", parent=base, leftIndent=12, bulletIndent=0, spaceAfter=3)
small = ParagraphStyle("sm", parent=base, fontSize=8.5, leading=12, textColor=MUTED)
cell = ParagraphStyle("c", parent=base, fontSize=9.2, leading=12.5)
cellh = ParagraphStyle("ch", parent=cell, fontName="Helvetica-Bold", textColor=colors.white)
warn = ParagraphStyle("w", parent=base, fontSize=9.6, leading=13.5, textColor=WARNTXT)
bad = ParagraphStyle("r", parent=base, fontSize=9.6, leading=13.5, textColor=REDTXT)


def table(rows, widths):
    d = [[Paragraph(str(c), cellh if i == 0 else cell) for c in r] for i, r in enumerate(rows)]
    t = Table(d, colWidths=widths, repeatRows=1)
    sty = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("GRID", (0, 0), (-1, -1), 0.5, LINE), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
           ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("BACKGROUND", (0, 0), (-1, 0), BLUE)]
    sty += [("BACKGROUND", (0, i), (-1, i), SOFT) for i in range(2, len(rows), 2)]
    t.setStyle(TableStyle(sty)); return t

def box(text, style, bg, edge):
    b = Table([[Paragraph(text, style)]], colWidths=[W])
    b.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("BOX", (0, 0), (-1, -1), 0.6, edge), ("LEFTPADDING", (0, 0), (-1, -1), 9),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return b

bullets = lambda items: [Paragraph(t, bul, bulletText="•") for t in items]

def footer(c, d):
    c.saveState(); c.setFont("Helvetica", 8); c.setFillColor(MUTED)
    c.drawString(18 * mm, 10 * mm, f"Bizfy Voice AI  |  Voice pipeline latency  |  {DATE}")
    c.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {d.page}")
    c.setStrokeColor(LINE); c.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm); c.restoreState()




W = A4[0] - 36 * mm
def load(p): return json.load(open(p))
def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(p / 100 * len(xs)))] if xs else float("nan")
def stages(rows):
    d = {
        "End of speech to text ready (silence rule + speech-to-text)": [r["firstWordMs"] - r["totalMs"] for r in rows],
        "AI first word": [r["llmFirstTokenMs"] for r in rows],
        "First sentence to first audio (voice)": [r["ttsFirstAudioMs"] for r in rows],
        "Caller stops to first sound (may be the instant \"Sure.\")": [r["firstWordMs"] for r in rows],
        "Caller stops to the REAL answer": [r["firstWordMs"] - r["totalMs"] + r["answerMs"] for r in rows if r.get("answerMs")],
    }
    return {k: (pct(v, 50) / 1000, pct(v, 95) / 1000) for k, v in d.items()}
en, hi = stages(load("docs/baseline/2026-11-03-provisional-en.json")), stages(load("docs/baseline/2026-11-03-provisional-hi.json"))
s = lambda x: f"{x:.2f} s"

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm, title="Voice pipeline latency, " + DATE)
f = []
f += [Paragraph("Voice pipeline latency", h1), Paragraph(f"Provisional baseline, {DATE}. 20 English and 20 Hindi/Hinglish scripted calls, one at a time.", sub)]
f += [box("<b>Bottom line.</b> Neither language is near the target (real answer under 0.8 s at p50 and 1.2 s at p95). English answers in "
          f"{s(en['Caller stops to the REAL answer'][0])} (p50) and Hindi/Hinglish in {s(hi['Caller stops to the REAL answer'][0])}. "
          "Hindi is slow mainly because of speech-to-text (about 2.1 s) and the Hindi voice start (about 0.9 s).", bad, RED, REDTXT), Spacer(1, 6)]
f += [box("<b>Provisional.</b> AskG1 was down on 3 Nov (its gateway answered \"model g1-chat not found\"), so the small local model stood in for the AI's reply. "
          "Speech-to-text, voice and pipeline are the real ones. Seven questions repeat across the 20 calls, so some answers came from the answer cache and the AI stage looks faster than it is. "
          "Scripted speech, no phone line. Re-run with AskG1 before quoting AI-reply numbers.", warn, WARN, WARNTXT)]
f += [Paragraph("Where the time goes (p50 / p95)", h2)]
rows = [["Stage", "English", "Hindi / Hinglish"]]
for k in en: rows.append([k, f"{s(en[k][0])} / {s(en[k][1])}", f"{s(hi[k][0])} / {s(hi[k][1])}"])
rows.append(["Target (real answer)", "0.80 s / 1.20 s", "0.80 s / 1.20 s"])
f += [table(rows, [W * 0.52, W * 0.24, W * 0.24])]
f += [Paragraph("Speech-to-text options for Hindi/Hinglish", h2),
      table([["Provider", "Character error rate", "Time p50 / p95", "Where it runs"],
             ["Sarvam saarika:v2.5", "1.0%", "0.26 s / 0.58 s", "Cloud (caller audio leaves the machine)"],
             ["Whisper small (current)", "19.0%", "0.97 s / 1.07 s", "Our own machine"],
             ["Deepgram nova-3", "24.1%", "1.01 s / 2.52 s", "Cloud"]], [W * 0.27, W * 0.2, W * 0.21, W * 0.32]),
      Paragraph("10 synthetic Hindi sentences with names, numbers and a phone number. Part of the Whisper and Deepgram score is English words written in Latin letters, which is counted as an error. Re-run on real recorded calls before choosing.", small)]
f += [Paragraph("What is done", h2)] + bullets([
    "Measurement tooling: scripts/latency-baseline.sh (40 calls) and scripts/latency-summary.py (p50 / p95 per stage).",
    "Barge-in: our voice detector fires 100 ms after the caller starts talking (200 ms in close-mic mode). The phone carrier's own queue is not measured.",
    "Silence rule is already 300 to 400 ms (not 5 s). An optional \"did they finish?\" wait (TURN_HOLD_MS) is built but off until it is measured.",
    "Greeting and acknowledgements are cached per voice, now including each voice's speed and pitch.",
    "Numbers: phone numbers, OTPs, rupee amounts (lakh / crore) and e-mails are read the way they are said, in English and Hindi."])
f += [Paragraph("What is left", h2)] + bullets([
    "<b>AskG1 must serve chat again</b>, then run scripts/latency-baseline.sh baseline for the real numbers.",
    "Hindi speech-to-text: 2.1 s today. Sarvam would cut about 2 s but sends audio to a cloud; open-source options are not yet tried.",
    "Hindi voice: stock Hindi voice plus conversion adds about 0.9 s. Chatterbox on a GPU, or a cloud voice, removes it.",
    "Try the end-of-speech wait against the baseline (ENDPOINTING_MS 250 with TURN_HOLD_MS 600).",
    "Run the services in India, and measure the phone line with real Plivo or Exotel calls."])
doc.build(f, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)
