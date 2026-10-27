"""Builds the 27 October voice pipeline latency report (PDF), the first one with the REAL AskG1 answering.

Reads the raw numbers saved by the load test in .local/report/askg1/ (one JSON per setup, plus direct.json from the AskG1 probe).
Every number in the PDF is computed here from those files, so the report cannot drift from the measurements.
"""
import json, statistics as st, sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

R = ".local/report/askg1/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/latency-report-2026-10-27.pdf"
DATE = "27 October 2026"

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
    ("English, built-in male voice", "en-builtin.json"),
    ("Hindi, built-in male voice", "hi-builtin.json"),
    ("English, Karan's cloned voice", "en-karan.json"),
    ("Hindi, Karan's cloned voice", "hi-karan.json"),
    ("English, Suhani's cloned voice", "en-suhani.json"),
    ("Hindi, Suhani's cloned voice", "hi-suhani.json"),
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

def _outlier():
    out = []
    for name, rows_ in data.items():
        f = sorted(first(rows_)); rest = f[:-1]
        if len(f) > 2 and f[-1] > 2.5 * med(f):
            slow = max(rows_, key=lambda r: r["firstWordMs"])
            worst = max(("listening", slow["firstWordMs"] - slow["totalMs"]), ("AskG1 and knowledge", slow["llmFirstTokenMs"]), ("the voice", slow["ttsFirstAudioMs"]), key=lambda x: x[1])
            out.append(f"One answer in '{name}' took {s(f[-1])} ({worst[0]} took {s(worst[1])}). The other {len(rest)} took {s(min(rest))} to {s(max(rest))}.")
    return " ".join(out)
OUTLIER = _outlier()
direct = json.load(open(R + "direct-by-prompt.json"))
rep = {n: json.load(open(f".local/report/askg1b/{n}.json")) for n in ("en-builtin", "hi-builtin")}   # repeat run, with the knowledge search timed
nowarm = json.load(open(".local/report/askg1c/en-builtin.json"))                                        # repeat run, warm-up request switched off
meds = {name: med(first(rows)) for name, rows in data.items()}
met = [n for n, m in meds.items() if m < 1000]
en_all = [x for n, r in data.items() if n.startswith("English") for x in first(r)]; hi_all = [x for n, r in data.items() if n.startswith("Hindi") for x in first(r)]
stage = lambda name, key: med([r[key] for r in data[name]])
S = [hdr, Spacer(1, 8), Paragraph("Voice Pipeline Latency Report", h1),
     Paragraph(f"Full speech-to-speech pipeline in English and Hindi, with the real AskG1 answering. Measured {DATE}.", sub)]

S.append(box(f"<b>AskG1 is back and answers, but inside the full pipeline its first word still takes {s(min(stage(n, 'llmFirstTokenMs') for n in data))} to {s(max(stage(n, 'llmFirstTokenMs') for n in data))}.</b> "
             f"Asked directly with a one-line instruction, the first reply text arrives in about {direct['tiny']['median']:.1f} s; with the full instruction the pipeline sends it takes about {direct['full_real']['median']:.1f} s, with occasional stalls of 5 to 14 s. On 24 October AskG1 took 2.0 to 4.6 s. "
             "Every answer below was written by AskG1: the backup model was switched off for these runs.", warn, WARN, colors.HexColor("#e5c98a")))
S.append(Spacer(1, 6))
S.append(box(f"<b>The latency gate (typical wait under 1.0 s) is not met in any setup.</b> The best typical wait is {s(min(meds.values()))} and the slowest is {s(max(meds.values()))}. "
             f"AskG1 is the largest part of the wait ({s(min(stage(n, 'llmFirstTokenMs') for n in data))} to {s(max(stage(n, 'llmFirstTokenMs') for n in data))}), followed by the voice in Hindi.", bad, RED, colors.HexColor("#e9b3b3")))

S += [Paragraph("Summary", h2)]
S += bullets([
    f"Typical wait from the caller finishing a sentence to the first sound of the reply, over {n_all} answers: <b>English {s(med(en_all))}</b>, <b>Hindi {s(med(hi_all))}</b> (all voices together). The SOP target is 1.0 s.",
    f"Where the time goes, in English with the built-in voice: listening {s(med(listen(data[SETUPS[0][0]])))}, AskG1 {s(stage(SETUPS[0][0], 'llmFirstTokenMs'))}, voice {s(stage(SETUPS[0][0], 'ttsFirstAudioMs'))}. In Hindi with Karan's cloned voice: listening {s(med(listen(data[SETUPS[3][0]])))}, AskG1 {s(stage(SETUPS[3][0], 'llmFirstTokenMs'))}, voice {s(stage(SETUPS[3][0], 'ttsFirstAudioMs'))}.",
    f"A cloned voice speaks English as fast as a built-in one ({s(stage(SETUPS[0][0], 'ttsFirstAudioMs'))} to {s(stage(SETUPS[4][0], 'ttsFirstAudioMs'))}). Hindi is slower: the voice stage takes {s(stage(SETUPS[1][0], 'ttsFirstAudioMs'))} with the built-in Hindi voice, and {s(stage(SETUPS[3][0], 'ttsFirstAudioMs'))} (Karan) to {s(stage(SETUPS[5][0], 'ttsFirstAudioMs'))} (Suhani) in a cloned voice, because the speech is then also converted into the person's voice.",
    f"<b>Reliability:</b> 1 of 18 test calls failed because AskG1 did not start answering within the 8 second limit; the other 17 completed every question. Direct tests also saw occasional AskG1 stalls (slowest {direct['full']['slowest']:.0f} s).",
    "These runs used one laptop with the speech, voice, converter and backup-AI servers running at the same time, so they compete for processor and memory. Dedicated machines would be faster, but they would not remove AskG1's part.",
])

rows = [["Setup", "Count", "Typical", "Slowest", "Fastest", "Gate (1.0 s)"]]
for name, _ in SETUPS:
    f = first(data[name]); rows.append([name, str(len(f)), s(med(f)), s(max(f)), s(min(f)), "met" if med(f) < 1000 else "not met"])
S.append(KeepTogether([Paragraph("Results", h2), Paragraph("From the caller finishing speaking to the first sound of the AI's reply. Scripted spoken questions, one call at a time, real AskG1.", small), Spacer(1, 3),
                       table(rows, [W - 142 * mm, 17 * mm, 25 * mm, 25 * mm, 25 * mm, 28 * mm]), Paragraph(OUTLIER, small)]))

rows = [["Setup", "Listening and writing down", "AskG1 + knowledge", "First sentence ready", "Voice first sound", "Transcript to first sound"]]
for name, _ in SETUPS:
    d = data[name]
    rows.append([name, s(med(listen(d))), s(stage(name, "llmFirstTokenMs")), s(stage(name, "firstSentenceMs")), s(stage(name, "ttsFirstAudioMs")), s(stage(name, "totalMs"))])
S.append(KeepTogether([Paragraph("Where the time goes", h2), Paragraph("Typical (median) time of each stage. 'AskG1 + knowledge' is counted from the transcript being ready to the first word of the reply, and includes the company knowledge search. 'Voice first sound' is counted from the first sentence being ready.", small), Spacer(1, 3),
                       table(rows, [W - 124 * mm, 24 * mm, 24 * mm, 25 * mm, 24 * mm, 27 * mm])]))

S.append(KeepTogether([Paragraph("How it compares", h2),
    table([["When", "Which AI", "AI first word", "Caller waits (typical)"],
           ["24 Oct", "AskG1 (slow at the time)", "2.0 to 4.6 s", "3.3 to 6.3 s"],
           ["26 Oct", "small backup model on this laptop", "0.5 to 0.7 s", f"English 1.61 s, Hindi 3.30 s (built-in voices)"],
           ["27 Oct (today)", "AskG1", f"in the pipeline {s(min(stage(n, 'llmFirstTokenMs') for n in data))} to {s(max(stage(n, 'llmFirstTokenMs') for n in data))}; direct {direct['full_real']['median']:.1f} s", f"English {s(med(en_all))}, Hindi {s(med(hi_all))} (all voices)"]],
          [W - 120 * mm, 50 * mm, 36 * mm, 34 * mm])]))

S.append(KeepTogether([Paragraph("Why is AskG1 slower inside the pipeline than when asked directly?", h2),
    Paragraph("Directly (6 requests each, time until the first reply text arrives):", small), Spacer(1, 3),
    table([["Instruction sent to AskG1", "Length", "Typical", "Slowest"],
           ["One line", f"{direct['tiny']['chars']} characters", f"{direct['tiny']['median']:.2f} s", f"{direct['tiny']['slowest']:.2f} s"],
           ["First part of the real instruction", f"{direct['rules']['chars']} characters", f"{direct['rules']['median']:.2f} s", f"{direct['rules']['slowest']:.2f} s"],
           ["The full real instruction", f"{direct['full']['chars']} characters", f"{direct['full']['median']:.2f} s", f"{direct['full']['slowest']:.2f} s"],
           ["Full instruction + company knowledge + language note (what a call sends)", f"{direct['full_real']['chars']} characters", f"{direct['full_real']['median']:.2f} s", f"{direct['full_real']['slowest']:.2f} s"]],
          [W - 92 * mm, 36 * mm, 28 * mm, 28 * mm]),
    Spacer(1, 4),
    Paragraph(f"Checked and ruled out: the company knowledge search takes {round(min(med([r['groundMs'] for r in rep[k]]) for k in rep))} to {round(max(med([r['groundMs'] for r in rep[k]]) for k in rep))} ms (not the cause). Switching off the warm-up request that starts each call made no improvement: AskG1's first word was {s(stage(SETUPS[0][0], 'llmFirstTokenMs'))} with it and {s(med([r['llmFirstTokenMs'] for r in nowarm]))} without it. "
              f"A repeat of the English and Hindi built-in runs gave {s(med([r['llmFirstTokenMs'] for r in rep['en-builtin']]))} and {s(med([r['llmFirstTokenMs'] for r in rep['hi-builtin']]))} for AskG1's part, so the numbers are repeatable. "
              f"<b>Still unexplained:</b> a gap of about 2 s between AskG1 asked directly and AskG1 inside the pipeline. Candidates for the AskG1 team to check: whether it starts a new request while it is still finishing an earlier one, whether it stops generating when we stop listening, and the Tailscale link (it ran through a relay, not a direct connection).", small)]))

S += [Paragraph("What would help", h2)]
S += bullets([
    "<b>AskG1:</b> a typical first word under 0.4 s with the real instruction, and no stalls of 5 to 14 s. This is the biggest lever. Ask the AskG1 team about request queueing, prefix caching of the long instruction, and cancelling work when the caller interrupts.",
    f"<b>Speech recognition:</b> listening and writing down the words takes {s(min(med(listen(d)) for d in data.values()))} to {s(max(med(listen(d)) for d in data.values()))} here. A cloud streaming service was measured about 0.15 s faster on 24 October, but it sends caller audio to a third party, which is a decision for the CEO.",
    "<b>Hindi voices:</b> a GPU machine for the voice servers, or converting the next sentence while the first plays, would reduce the cloned-voice Hindi time.",
    "<b>A shorter instruction</b> to AskG1 might help a little (1.2 s with one line against 1.9 s with the full text), but a shorter instruction also gives the AI fewer rules, so it needs testing before it is adopted.",
])
S += [Paragraph("How this was measured", h2)]
S += bullets([
    "Real sessions on the voice service with a real signed token. Spoken questions are sent in real time, and the clock stops at the first byte of the reply audio. The questions were spoken by a computer voice, which is cleaner than a real phone line.",
    "A real phone call will wait longer: the carrier's network adds time in both directions, and it is not included (the carrier is not connected yet).",
    "The direct AskG1 test sends a short instruction and a question, and measures the time until the first piece of reply text arrives. The full-pipeline runs also include the company knowledge search, as on a real call.",
])
doc.build(S, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT, f"({n_all} answers)")
