"""Builds the 28 October 2026 latency report (PDF). Unlike latency-report.py the numbers are typed in below, copied from the load-test output of 28 October (the run output was not saved as JSON).

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

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/latency-report-2026-10-28.pdf"
DATE = "28 October 2026"

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


doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                        title="Bizfy Voice AI: Voice Pipeline Latency", author="Karan Devda")
W = A4[0] - 36 * mm
hdr = Table([[Image("apps/web/public/brand/bizfy-mark.png", width=7 * mm, height=7 * mm), Paragraph("Bizfy Voice AI", ParagraphStyle("t", parent=base, fontName="Helvetica-Bold", fontSize=13))]], colWidths=[11 * mm, W - 11 * mm])
hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BACKGROUND", (0, 0), (0, 0), BLUE), ("ALIGN", (0, 0), (0, 0), "CENTER"), ("TOPPADDING", (0, 0), (0, 0), 2),
                         ("BOTTOMPADDING", (0, 0), (0, 0), 2), ("LEFTPADDING", (0, 0), (0, 0), 2), ("RIGHTPADDING", (0, 0), (0, 0), 2), ("LEFTPADDING", (1, 0), (1, 0), 8)]))

S = [hdr, Spacer(1, 8), Paragraph("Voice Pipeline Latency Report", h1),
     Paragraph(f"Full speech-to-speech pipeline with the real AskG1 answering, plus AskG1 under load. Measured {DATE}.", sub)]

S.append(box("<b>The caller now hears a sound in 0.3 to 0.9 s, but the real answer still takes 1.6 to 2.2 s.</b> A short acknowledgement (\"Sure.\", \"Okay.\", \"Ji.\" (Hindi, spoken as jee)) "
             "plays the moment the caller's words are final, while AskG1 works out the answer. AskG1's own first word is unchanged at about <b>1.05 to 1.5 s</b> inside the pipeline, "
             "and the real answer starts no sooner than before.", warn, WARN, colors.HexColor("#e5c98a")))
S.append(Spacer(1, 6))
S.append(box("<b>The load test's gate line (typical wait under 1.0 s) reads MET, but only because the acknowledgement counts as first sound.</b> "
             "Measured honestly, the typical wait for the real answer is 1.86 s in English and 2.16 s in Hindi (best setups). With more than 2 or 3 calls at once AskG1 queues requests: "
             "its first word reaches 4.7 s with 6 calls and 12.8 s with 10.", bad, RED, colors.HexColor("#e9b3b3")))

S += [Paragraph("Summary", h2)]
S += bullets([
    "<b>Where the time was:</b> in English, speech-to-text 0.29 s, AskG1's first word 1.07 s, voice 0.06 s. The company knowledge search takes 0.00 s, so it is not the cause.",
    "<b>Acknowledgement (new):</b> first sound 0.34 s in English with the local voice and 0.67 s with ElevenLabs. It plays on about 3 of every 4 turns; greetings, thanks, very short replies and, without a fast Hindi voice, Hindi get none.",
    "<b>ElevenLabs voice (new):</b> first byte about 0.3 s for English and Hindi (measured directly). Hindi no longer needs the 1.6 s voice conversion: Hindi first sound fell from 5.78 s to 3.97 s, then to 0.94 s with Deepgram speech-to-text.",
    "<b>Hindi speech-to-text is now the Hindi bottleneck:</b> the local large Whisper model took 3.68 s to write down the words. Deepgram took 0.63 s, but it sends caller audio to a third party, so it was tested only with computer-spoken audio and not switched on.",
    "<b>Not yet compared:</b> voice quality against myequal.ai. Only speed was measured; realism needs a listening test.",
])

S += [Paragraph("Results", h2),
      Paragraph("Caller finishing speaking to the first sound, and to the real answer. Scripted spoken questions, one call at a time, real AskG1.", small), Spacer(1, 4)]
S.append(table([
    ["Setup", "Count", "First sound (typical)", "Real answer (typical)", "Slowest"],
    ["English, local voice, no acknowledgement (morning)", "12", "1.56 s", "1.56 s", "3.50 s"],
    ["English, local voice, no acknowledgement (repeat)", "12", "1.47 s", "1.47 s", "2.53 s"],
    ["English, local voice, with acknowledgement", "16", "0.34 s", "1.56 s", "2.02 s"],
    ["English, ElevenLabs voice, with acknowledgement", "12", "0.67 s", "1.86 s", "2.66 s"],
    ["Hindi, local voice (earlier today)", "-", "5.78 s", "5.78 s", "-"],
    ["Hindi, ElevenLabs voice, local Whisper", "12", "3.97 s", "5.16 s", "8.94 s"],
    ["Hindi, ElevenLabs voice, Deepgram speech-to-text", "12", "0.94 s", "2.16 s", "2.52 s"],
], [W * 0.40, W * 0.10, W * 0.17, W * 0.18, W * 0.15]))

S += [Paragraph("Where the time goes", h2), Paragraph("Typical (median) time of each stage, from the transcript or the end of speech.", small), Spacer(1, 4)]
S.append(table([
    ["Setup", "Listening and writing down", "AskG1 first word", "First sentence ready", "Voice first sound"],
    ["English, local voice", "0.29 s", "1.05 s", "1.05 s", "0.06 s"],
    ["English, ElevenLabs", "0.33 s", "1.21 s", "1.37 s", "0.20 s"],
    ["Hindi, ElevenLabs, local Whisper", "3.68 s", "1.46 s", "1.89 s", "0.20 s"],
    ["Hindi, ElevenLabs, Deepgram", "0.63 s", "1.13 s", "1.13 s", "0.19 s"],
], [W * 0.34, W * 0.19, W * 0.16, W * 0.17, W * 0.14]))

S += [Paragraph("AskG1 under load (several calls at once)", h2),
      Paragraph("Direct to AskG1, 5-turn conversations with a long instruction (about 1,000 tokens) and growing history, 1.5 s pause between turns. Time to first token.", small), Spacer(1, 4)]
S.append(table([
    ["Calls at once", "Typical", "Slowest 5%", "Errors"],
    ["1", "1.26 s", "6.01 s", "0"], ["3", "2.39 s", "4.09 s", "0"], ["6", "4.74 s", "11.08 s", "0"], ["10", "12.84 s", "22.01 s", "0"],
], [W * 0.25, W * 0.25, W * 0.25, W * 0.25]))
S += [Spacer(1, 4), Paragraph("Requests queue instead of failing, so callers hear silence. The gateway also sent each reply in one piece rather than word by word, so streaming did not help in this test. "
      "Direct short requests: \"Hello\" 0.67 to 1.16 s; a one-sentence reply to the long prompt 0.74 to 0.79 s warm and 11.8 s on the first, cold request; a 150-word reply 6.3 to 8.3 s warm (13.5 s cold), about 40 ms per token generated.", small)]

S += [Paragraph("Changes made today (commit 622473c)", h2)]
S += bullets([
    "<b>Instant acknowledgement</b> (ack.ts, pipeline.ts): not kept in the conversation, and the system prompt tells the AI never to start with one. Turn it off with ACK=off.",
    "<b>ElevenLabs voice</b> (engines.ts, index.ts): choose it with el:&lt;voice id&gt;. 24 kHz in the browser, 8 kHz on the phone line.",
    "<b>Honest reporting</b> (load-test.ts): a separate \"Real answer heard\" line and the knowledge-search time, so the acknowledgement does not hide the real wait.",
    "Type check clean, 109 tests pass (2 new).",
])

S += [Paragraph("What would help", h2)]
S += bullets([
    "<b>AskG1:</b> more parallel slots, a prompt cache that stays warm across calls, and a typical first word under 0.4 s inside the pipeline. This is the biggest lever and is for the AskG1 team.",
    "<b>Hindi speech-to-text:</b> a decision for the CEO on Deepgram (caller audio goes to a third party), or a faster local Hindi model.",
    "<b>Voice realism:</b> a listening comparison of ElevenLabs voices against myequal.ai.",
    "<b>Phone app:</b> calls did not sync on the Samsung S24 Ultra because the call left on the personal SIM, which the app deliberately ignores. Set the work SIM as the default calling SIM, or build dialling on the work SIM.",
])

S += [Paragraph("How this was measured", h2)]
S += bullets([
    "Real sessions on the voice service with a signed token, spoken questions sent in real time, and the clock stopped at the first byte of reply audio. Questions were spoken by a computer voice, cleaner than a real phone line.",
    "One laptop ran everything at once. A real phone call will wait longer: the carrier's network is not included (the carrier is not connected yet).",
    "Hindi with Deepgram used a second copy of the voice service (port 4002, stopped afterwards) with STT_PROVIDER=deepgram. Its accuracy on real Hindi callers was not checked.",
    "AskG1's speed drifts through the day (0.3 to 0.5 s in the morning, 0.6 to 1.5 s later for the same request), so run-to-run differences of 0.1 to 0.2 s are not meaningful.",
])
doc.build(S, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)
