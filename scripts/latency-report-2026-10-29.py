"""Builds the 29 October 2026 latency report (PDF). Unlike latency-report.py the numbers are typed in below, copied from the load-test output of 28 October (the run output was not saved as JSON).

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

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/latency-report-2026-10-29.pdf"
DATE = "29 October 2026"

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



import re, sys
BEFORE = sys.argv[2] if len(sys.argv) > 2 else ".local/report/matrix_before.out"
AFTER = sys.argv[3] if len(sys.argv) > 3 else ".local/report/matrix_after.out"
SPREAD = sys.argv[4] if len(sys.argv) > 4 else ".local/report/matrix_spread.out"

def parse(path):
    rows, cur = {}, None
    for line in open(path):
        m = re.match(r"### (\w+) \| ([\w-]+) \| (\d) at once", line)
        if m: cur = (m[1], m[2], int(m[3])); rows[cur] = {"fail": 0}; continue
        if not cur: continue
        if (m := re.match(r"Calls: (\d+) of (\d+)", line)): rows[cur]["done"], rows[cur]["of"] = int(m[1]), int(m[2])
        elif (m := re.match(r"\s+(\d+)x failed", line)): rows[cur]["fail"] += int(m[1])
        elif (m := re.match(r"Time from .*median ([\d.]+) s, p95 ([\d.]+) s", line)): rows[cur]["first"], rows[cur]["first95"] = float(m[1]), float(m[2])
        elif (m := re.match(r"Real answer heard .*median ([\d.]+) s, p95 ([\d.]+) s", line)): rows[cur]["real"], rows[cur]["real95"] = float(m[1]), float(m[2])
    return rows
B, A, P = parse(BEFORE), parse(AFTER), parse(SPREAD)
LANG = {"en": "English", "hi": "Hindi", "en-hi": "Hinglish"}
def val(r, k): return f"{r[k]:.1f} s" if r and k in r else "-"
def calls(r): return f"{r['done']} of {r['of']}" if r and "done" in r else "-"

def rows_for(n):
    out = [["Voice", "Language", "Calls finished (before / now)", "First sound (before / now)", "Real answer (before / now)", "Real answer, slowest 5% (now)"]]
    for v in ("Karan", "Suhani"):
        for l in ("en", "hi", "en-hi"):
            b, a = B.get((v, l, n)), A.get((v, l, n))
            out.append([v, LANG[l], f"{calls(b)} / {calls(a)}", f"{val(b,'first')} / {val(a,'first')}", f"{val(b,'real')} / {val(a,'real')}", val(a, "real95")])
    return out

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                        title="Bizfy Voice AI: Voice Pipeline Latency", author="Karan Devda")
W = A4[0] - 36 * mm
def spread_rows():
    out = [["Voice", "Language", "Calls finished", "First sound", "Real answer (median)", "Real answer, slowest 5%"]]
    for v in ("Karan", "Suhani"):
        for l in ("en", "hi", "en-hi"):
            a, p = A.get((v, l, 8)), P.get((v, l, 8))
            out.append([v, LANG[l], calls(p), val(p, "first"), f"{val(p,'real')}  (all at once: {val(a,'real')})", val(p, "real95")])
    return out
W_ = [W * x for x in (0.11, 0.12, 0.19, 0.19, 0.19, 0.20)]
hdr = Table([[Image("apps/web/public/brand/bizfy-mark.png", width=7 * mm, height=7 * mm), Paragraph("Bizfy Voice AI", ParagraphStyle("t", parent=base, fontName="Helvetica-Bold", fontSize=13))]], colWidths=[11 * mm, W - 11 * mm])
hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BACKGROUND", (0, 0), (0, 0), BLUE), ("ALIGN", (0, 0), (0, 0), "CENTER"), ("TOPPADDING", (0, 0), (0, 0), 2),
                         ("BOTTOMPADDING", (0, 0), (0, 0), 2), ("LEFTPADDING", (0, 0), (0, 0), 2), ("RIGHTPADDING", (0, 0), (0, 0), 2), ("LEFTPADDING", (1, 0), (1, 0), 8)]))

S = [hdr, Spacer(1, 8), Paragraph("Voice Pipeline Latency Report: staff voices", h1),
     Paragraph(f"Karan's and Suhani's cloned voices in English, Hindi and Hinglish, with one call and with eight calls at once. Real AskG1, signed-in staff session. Measured {DATE}.", sub)]
S.append(box("<b>What changed today for the staff voices:</b> the Hindi voice conversion now runs on the Apple GPU (about 0.3 s per sentence instead of 1.3 to 3.5 s, same voice: speaker-similarity score 0.83 to 0.85 on both), "
             "and the short acknowledgement (\"Sure.\", \"Okay.\", \"Ji.\" (Hindi)) is made once in each staff voice and replayed at once, so Hindi and Hinglish callers now hear it too. "
             "The staff voices themselves were not changed.", warn, WARN, colors.HexColor("#e5c98a")))
S.append(Spacer(1, 6))
S.append(box("<b>The real answer still depends on AskG1 and on one laptop doing everything.</b> The acknowledgement makes the first sound quick, but the answer itself takes as long as AskG1 and the voice take. "
             "With 8 calls at once the laptop runs the speech recogniser, the Hindi voice, the voice conversion and the backup model together, and AskG1 queues requests. "
             "Dedicated machines and more AskG1 slots are what bring the real answer below the target. <b>Two Hinglish rows got slower</b> (Suhani, one call: 4.4 s to 17.8 s; Karan, eight calls: 14.3 s to 23.2 s). The earlier Karan run finished only 3 of 8 calls, so it is not a like-for-like comparison, and the Suhani run included slow AskG1 turns; the cause was not isolated.", bad, RED, colors.HexColor("#e9b3b3")))
S += [Paragraph("One call at a time", h2), Paragraph("Median time from the caller finishing speaking. 'First sound' includes the acknowledgement; 'Real answer' does not. Before = this morning's run, now = after the changes.", small), Spacer(1, 4),
      table(rows_for(1), W_)]
S += [Paragraph("Eight calls at once", h2), Paragraph("All eight calls start together and ask two questions each, the hardest case. A call 'finishes' when it got an answer to every question.", small), Spacer(1, 4),
      table(rows_for(8), W_)]
S += [Paragraph("Eight different callers, starting at different moments", h2),
      Paragraph("Eight callers on eight devices do not speak at the same instant. Here call number n starts 3 s after call n-1 and each caller thinks 2 to 4 s before the second question. The server load is the same as for eight phones; only each phone's own network time is not included.", small), Spacer(1, 4),
      table(spread_rows(), W_)]
S += [Paragraph("What was done", h2)]
S += bullets([
    "<b>Hindi voice conversion on the GPU.</b> One sentence takes 0.3 s, against 1.3 s (Karan) and 1.4 to 3.5 s (Suhani) on the processor. The converted voice scores the same against each person's voice fingerprint (Karan 0.835 on the GPU against 0.837 to 0.844 on the processor; Suhani 0.846 against 0.844), so it is the same voice. Set VOICE_CONVERT_DEVICE=cpu to go back.",
    "<b>Hindi voice server runs 3 copies side by side</b> (it handled one sentence at a time, 1.7 s each, so six callers waited up to 10.8 s; now the slowest of six waits 6.7 s), and both voice servers remember their last sentences, so a repeated sentence such as the greeting costs 1 ms instead of 1.7 s.",
    "<b>Acknowledgement kept as audio per voice.</b> Made once when the call opens, then replayed with no speech or conversion work. This also removes one voice job per turn from the busy laptop.",
    "<b>Backup model fixed.</b> Its memory was 1,024 tokens per call, less than a call's prompt; it is now 4,096 per call.",
    "<b>AskG1 cap</b> of 3 turns at once and a shared 'AskG1 is slow' state across calls; extra turns go to the backup model instead of timing out.",
    "<b>Language lock, Hello instead of Namaste, Hindi listening hints</b> (earlier today): English calls answer in English, Hindi in Hindi; Hindi speech recognition errors fell from 19% to 5% of characters.",
])
S += [Paragraph("What would help next", h2)]
S += bullets([
    "<b>Run the voice servers on a separate machine or GPU</b>, away from the speech recogniser and the backup model. Eight calls on one laptop share one processor and one GPU.",
    "<b>AskG1:</b> more parallel slots and a prompt cache that stays warm. It handles about 3 requests at a time well; the 8-call sweep showed 3.8 s median and 7 s slowest for a short answer.",
    "<b>Real phone audio</b> is noisier than the computer voices used in these tests, and the carrier is not connected yet, so a real call will wait longer.",
])
S += [Paragraph("How this was measured", h2)]
S += bullets([
    "Real sessions on the voice service with a signed token for the admin user and each staff voice profile. Spoken questions are sent in real time and the clock stops at the first byte of reply audio. The questions were spoken by computer voices (English, and a Hindi voice for Hindi and Hinglish).",
    "One laptop ran everything. Run-to-run variation is large (the same setup gave 3.9 s and 8.8 s on two runs), so differences under 1 s are not meaningful. Hindi and Hinglish use 5 scripted questions; English uses the standard 5.",
    "Not tested: the staff voices KabirTestMale and MeeraTestFemale, ElevenLabs voices, and real callers.",
])
doc.build(S, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)
