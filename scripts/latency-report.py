"""Builds the voice pipeline latency report (PDF) from the raw numbers saved by the load test.

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

R = ".local/report/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/latency-report-2026-10-26.pdf"
DATE = "26 October 2026"

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

SETUPS = [
    ("English, built-in male voice", "A-en-builtin.json"),
    ("Hindi, built-in male voice", "A-hi-builtin.json"),
    ("English, Karan's cloned voice", "A-en-karan.json"),
    ("Hindi, Karan's cloned voice (converted into his voice)", "A-hi-karan.json"),
]
data = {name: json.load(open(R + f)) for name, f in SETUPS}
s = lambda ms: f"{ms / 1000:.2f} s"
med = lambda xs: st.median(xs)
def p95(xs): xs = sorted(xs); return xs[min(len(xs) - 1, int(0.95 * len(xs)))]
first = lambda rows: [r["firstWordMs"] for r in rows]
listen = lambda rows: [r["firstWordMs"] - r["totalMs"] for r in rows]
allfirst = [x for rows in data.values() for x in first(rows)]
n_all = len(allfirst)


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

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                        title="Bizfy Voice AI: Voice Pipeline Latency", author="Karan Devda")
W = A4[0] - 36 * mm
hdr = Table([[Image("apps/web/public/brand/bizfy-mark.png", width=7 * mm, height=7 * mm), Paragraph("Bizfy Voice AI", ParagraphStyle("t", parent=base, fontName="Helvetica-Bold", fontSize=13))]], colWidths=[11 * mm, W - 11 * mm])
hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BACKGROUND", (0, 0), (0, 0), BLUE), ("ALIGN", (0, 0), (0, 0), "CENTER"), ("TOPPADDING", (0, 0), (0, 0), 2),
                         ("BOTTOMPADDING", (0, 0), (0, 0), 2), ("LEFTPADDING", (0, 0), (0, 0), 2), ("RIGHTPADDING", (0, 0), (0, 0), 2), ("LEFTPADDING", (1, 0), (1, 0), 8)]))

en_med = med(first(data[SETUPS[0][0]])); hi_med = med(first(data[SETUPS[1][0]]))
S = [hdr, Spacer(1, 8), Paragraph("Voice Pipeline Latency Report", h1),
     Paragraph(f"Full speech-to-speech pipeline in English and Hindi, running on one laptop. Measured {DATE}.", sub)]

S.append(box("<b>The real AskG1 was not measured today, and these numbers are not AskG1's.</b> Its machine is reachable over the VPN, but its API did not answer "
             "today (requests hang until they time out). Every answer in this report came from a <b>small backup model (Llama 3.2, 3 billion parameters) running on the same laptop</b>. "
             "The last real measurement of AskG1 was on 24 October: its first word took <b>2.0 to 4.6 s</b>, so a caller waited <b>3.3 to 6.3 s</b> for the first sound, against a budget of 0.3 to 0.4 s for the first word.",
             warn, WARN, colors.HexColor("#e5c98a")))
S.append(Spacer(1, 6))
S.append(box(f"<b>The latency gate (typical wait under 1.0 s) is not met.</b> Today's typical wait is {s(en_med)} in English and {s(hi_med)} in Hindi even with a fast local model. "
             "With AskG1 at its last measured speed it would be several times over the gate.", bad, RED, colors.HexColor("#e9b3b3")))

S += [Paragraph("Summary", h2)]
S += bullets([
    f"Time from the caller finishing a sentence to the first sound of the AI's reply, typical (median) of {n_all} answers: <b>{s(en_med)} English</b>, <b>{s(hi_med)} Hindi</b> with the built-in voices.",
    "A cloned voice costs little in English. In Hindi, the voice is first spoken by a built-in Hindi voice and then converted into the person's voice, which adds time to every sentence (see the table).",
    f"English: the wait is split between listening and writing down the words (about {s(med(listen(data[SETUPS[0][0]])))}) and the AI's reply (about {s(med([r['totalMs'] for r in data[SETUPS[0][0]]]))}). The English voice itself is fast.",
    f"Hindi: the voice is the largest part ({s(med([r['ttsFirstAudioMs'] for r in data[SETUPS[1][0]]]))} with the built-in voice, {s(med([r['ttsFirstAudioMs'] for r in data[SETUPS[3][0]]]))} in Karan's cloned voice), because Hindi is made in two steps.",
    "The SOP gate can only be met with a fast AskG1 (first word 0.3 to 0.4 s), faster speech recognition, and the voice on dedicated hardware. None of these is in place yet.",
])

def _outlier():
    out = []
    for name, rows_ in data.items():
        f = sorted(first(rows_)); rest = f[:-1]
        if f[-1] > 2.5 * med(f):
            slow = max(rows_, key=lambda r: r["firstWordMs"])
            out.append(f"One answer in '{name}' took {s(f[-1])}: the voice stage stalled for {s(slow['ttsFirstAudioMs'])}. The cause was not found. The other {len(rest)} answers took {s(min(rest))} to {s(max(rest))}.")
    return " ".join(out)
OUTLIER = _outlier()
rows = [["Setup", "Count", "Typical", "Slowest", "Fastest"]]
for name, _ in SETUPS:
    f = first(data[name]); rows.append([name, str(len(f)), s(med(f)), s(p95(f)), s(min(f))])
rows.append(["SOP gate", "", "1.00 s or less", "1.50 s or less", ""])
S.append(KeepTogether([Paragraph("Results", h2), Paragraph("From the caller finishing speaking to the first sound of the AI's reply. Scripted spoken questions, one call at a time.", small), Spacer(1, 3),
                       table(rows, [W - 108 * mm, 18 * mm, 30 * mm, 30 * mm, 30 * mm]),
                       Paragraph(OUTLIER, small)]))

rows = [["Setup", "Listening and writing down", "AI first word", "AI first sentence", "Voice first sound", "Transcript to first sound"]]
for name, _ in SETUPS:
    d = data[name]
    rows.append([name, s(med(listen(d))), s(med([r["llmFirstTokenMs"] for r in d])), s(med([r["firstSentenceMs"] for r in d])), s(med([r["ttsFirstAudioMs"] for r in d])), s(med([r["totalMs"] for r in d]))])
S.append(KeepTogether([Paragraph("Where the time goes", h2), Paragraph("Typical (median) time of each stage. 'AI first word' is counted from the transcript being ready. 'Voice first sound' is counted from the first sentence being ready.", small), Spacer(1, 3),
                       table(rows, [W - 120 * mm, 24 * mm, 20 * mm, 24 * mm, 24 * mm, 28 * mm])]))

# Measured earlier on 26 October with the same load-test tool, against a stand-in AI that starts replying after 0.35 s.
S.append(KeepTogether([Paragraph("Many calls at once", h2),
    Paragraph("Measured on 26 October with a stand-in AI that starts answering after 0.35 s, one laptop, built-in English voice. This shows the load limit of the voice machines, not of AskG1.", small), Spacer(1, 3),
    table([["Test", "Result", "Typical wait", "Slowest"],
           ["1 call", "finished", "1.24 to 1.38 s", "-"],
           ["20 calls at the same time", "20 of 20 finished, none dropped", "6.32 s", "11.67 s"],
           ["24 calls at the same time", "20 served, 4 refused (limit is 20)", "6.92 s", "12.34 s"],
           ["50 scripted calls, 10 at a time, 2 questions each", "50 of 50 finished, 100 answers", "1.53 s", "3.82 s"]],
          [W - 112 * mm, 54 * mm, 30 * mm, 28 * mm])]))

S += [Paragraph("What would fix it", h2)]
S += bullets([
    "<b>AskG1:</b> its API must be up, and its first word must come in 0.3 to 0.4 s, not 2 to 4.6 s. This is for the AskG1 team.",
    f"<b>Speech recognition:</b> listening and writing down the words takes {s(min(med(listen(d)) for d in data.values()))} to {s(max(med(listen(d)) for d in data.values()))} here. On 24 October a cloud streaming service was measured about 0.15 s faster, but it sends caller audio to a third party, which is a decision for the CEO.",
    "<b>Voices:</b> run the voice machines on a GPU server, not a laptop. Twenty calls at once on one laptop pushes the typical wait to about 6 s.",
    "<b>Hindi in a cloned voice:</b> converting each sentence into the person's voice adds time. Converting while the next sentence is being made would reduce it.",
])

S += [Paragraph("How this was measured", h2)]
S += bullets([
    "Real sessions on the voice service, with a real signed token, spoken questions sent in real time, and the clock stopped at the first byte of the AI's reply. The questions were spoken by a computer voice, which is cleaner than a real phone line.",
    "A real phone call will wait longer: the carrier's network adds time in both directions, and it is not included here (the carrier is not connected yet). Everything ran on one Apple laptop, so the speech, voice, voice-conversion and backup-AI servers competed for the same processor.",
    "The company knowledge base was on, as on a real call. A test call counts only if every question was answered within 60 seconds.",
    "This test found a bug, fixed the same day: the Hindi noise filter wrongly dropped some Hindi sentences. All calls above were answered.",
])
doc.build(S, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT, f"({n_all} answers)")
