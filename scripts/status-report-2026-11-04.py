"""Builds the 4 November 2026 status report (PDF): latency, AskG1 / OpenRouter, clone-voice quality, TTS options, open issues.
Numbers come from docs/baseline/2026-11-03-*.json (scripts/latency-baseline.sh) and the model-only run of 4 Nov (typed below)."""
import sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/status-report-2026-11-04.pdf"
INK, MUTED, ACC = colors.HexColor("#1B2333"), colors.HexColor("#5B6577"), colors.HexColor("#2F5BEA")
H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=INK, spaceAfter=2)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=ACC, spaceBefore=14, spaceAfter=5)
H3 = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK, spaceBefore=6, spaceAfter=2)
B = ParagraphStyle("b", fontName="Helvetica", fontSize=9.3, leading=13.2, textColor=INK, spaceAfter=3)
BL = ParagraphStyle("bl", parent=B, leftIndent=11, bulletIndent=1)
SM = ParagraphStyle("sm", parent=B, fontSize=8, leading=11, textColor=MUTED)
C = ParagraphStyle("c", fontName="Helvetica", fontSize=8.3, leading=10.6, textColor=INK)
CB = ParagraphStyle("cb", parent=C, fontName="Helvetica-Bold")
def p(t, st=B): return Paragraph(t, st)
def bl(items): return [Paragraph(t, BL, bulletText="•") for t in items]
def tbl(rows, widths, head=True):
    data = [[Paragraph(str(c), CB if (head and i == 0) else C) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEFB")), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C3CCDD")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return t
def foot(c, d):
    c.saveState(); c.setFont("Helvetica", 7.5); c.setFillColor(MUTED)
    c.drawString(18 * mm, 10 * mm, "Voice AI: status, latency and voice quality | 4 November 2026"); c.drawRightString(192 * mm, 10 * mm, f"Page {d.page}"); c.restoreState()

s = [p("Voice AI: latency, AI reply and voice quality", H1), p("Status and open issues | 4 November 2026 | all numbers measured on a development Mac with scripted speech, one call at a time, no phone line", SM), Spacer(1, 4),
 p("Where we stand", H2),
 *bl(["<b>The target is not met in either language.</b> Goal: the real answer within 0.8 s (median) and 1.2 s (95th percentile). Measured: English 1.70 s median, Hindi 2.29 s median after switching Hindi speech-to-text to Sarvam (3.62 s before).",
      "<b>The AI reply is now the largest cost in English</b> (1.32 s to the first word, median) and the second largest in Hindi (1.44 s). Both AI services we can use today (AskG1 and OpenRouter) take 1.3 to 1.6 s to start answering, so neither can reach 0.8 s on its own.",
      "<b>Cloned Hindi voices do not yet sound like ElevenLabs.</b> Hindi in a cloned voice is made by two engines in a row, which costs time and causes tone drift, clipped words and noise at the end of sentences. The best open-source fix (Chatterbox, one pass, own voice) is chosen but is not running yet.",
      "<b>Several measurements are still missing:</b> the real phone line (carrier delay), AskG1 over a full call when warm, and tests with real callers instead of scripted audio."]),
 p("1. Response time, before and after", H2),
 tbl([["Median (p50) / 95th percentile (p95)", "English before", "Hindi before", "Hindi after Sarvam STT"],
      ["Caller stops → text ready (endpoint + speech-to-text)", "0.29 s / 0.50 s", "2.02 s / 2.15 s", "0.71 s / 0.96 s"],
      ["AI first word", "1.32 s / 2.90 s", "1.11 s / 1.78 s", "1.44 s / 2.00 s"],
      ["Caller stops → first sound (often the instant “Sure.”)", "0.29 s / 3.63 s", "2.02 s / 3.81 s", "0.71 s / 2.92 s"],
      ["<b>Caller stops → real answer heard</b>", "<b>1.70 s / 3.63 s</b>", "<b>3.62 s / 5.63 s</b>", "<b>2.29 s / 3.61 s</b>"],
      ["Target", "0.8 s / 1.2 s", "0.8 s / 1.2 s", "0.8 s / 1.2 s"]], [72, 32, 32, 40]),
 p("20 scripted calls per column, one at a time, run on 3 November 2026 with OpenRouter standing in for AskG1 (AskG1 was down that day). Seven questions repeat, so a few answers came from the answer cache. The English “after” column has not been re-run.", SM),
 p("What changed Hindi from 3.62 s to 2.29 s", H3),
 *bl(["Hindi speech-to-text moved from local Whisper (2.0 s) to Sarvam (0.7 s). In a separate test on 10 Hindi sentences Sarvam made 1.0% character errors against 19% for local Whisper and 24% for Deepgram, at 0.26 s per phrase.",
      "<b>Cost of that win:</b> caller audio now goes to Sarvam’s cloud. Clients who need private, on-premise AI cannot use it; local Whisper remains the self-hosted option."]),
 p("2. AI reply: AskG1 and OpenRouter", H2),
 p("Model-only test, 4 November, 10 identical short Hindi requests per model (no speech, no voice):", B),
 tbl([["Model", "First token p50", "First token p95", "Full answer p50", "Full answer p95"],
      ["AskG1 (g1-chat, over Tailscale)", "1.58 s", "3.76 s", "2.62 s", "5.00 s"],
      ["OpenRouter (gpt-4o-mini)", "1.30 s", "2.13 s", "1.55 s", "2.20 s"],
      ["Local Llama 3.2 3B (backup)", "0.09 s", "0.10 s", "1.01 s", "1.83 s"]], [62, 30, 30, 32, 32]),
 p("The Mac was under load during this run and the sample is small, so treat the figures as indicative. AskG1’s speed drifts through the day (0.3 to 1.2 s on the same request in earlier tests).", SM),
 p("Issues with AskG1", H3),
 *bl(["<b>Cold-prompt delay.</b> AskG1 keeps a saved copy of the start of the last prompt it read. A prompt it has not read recently waits 6 to 13 s. The voice service gives AskG1 8 s, so a cold call silently falls back to the small local model, which is clearly worse in Hindi (this is what the Hindi test call showed).",
      "<b>Slow even when warm.</b> 1.58 s to the first word today against about 0.7 s measured earlier; 95th percentile 3.76 s.",
      "<b>Does not scale with calls.</b> On 28 October: one call 1.3 s, six at once 4.7 s, ten at once 12.8 s (median). It needs more parallel slots.",
      "<b>Makes up facts.</b> With no matching company knowledge it has invented prices and a “free trial”, even with the do-not-guess rule in the prompt. This is a customer-trust risk, not only a speed one.",
      "<b>Availability.</b> On 3 November its gateway answered “model g1-chat not found”. It also needs Tailscale to be running; when Tailscale was off (29 October) every call said it had trouble.",
      "<b>Fragile warm-up.</b> Any edit to the system prompt makes the next calls cold (English answer 4.0 s right after an edit, 1.7 s once warm)."]),
 p("Issues with OpenRouter (used as a stand-in)", H3),
 *bl(["<b>Still above target.</b> 1.30 s to the first word at the median; the 0.8 s goal for the whole answer is not reachable with it.",
      "<b>Data leaves our control.</b> Questions and company knowledge go to a third-party cloud. Fine for a stand-in, not for private-AI clients.",
      "<b>Internet and vendor dependent</b> (pricing, rate limits, model changes). Spend so far is about $0.04 of a $5 test budget.",
      "<b>Hindi quality is decent but not tuned</b> to our prompt and company knowledge the way AskG1 is meant to be."]),
 p("Options to reach the target", H3),
 *bl(["Keep AskG1 as the main model but give it more slots, longer cache retention and a keep-warm ping; raise the 8 s limit so cold calls do not drop to the weak model.",
      "Test a fast hosted open model (for example Llama or Qwen on Groq) for first-word time. Not measured yet.",
      "Use a larger local model on a GPU server in India. Fastest and private, but needs hardware."]),
 PageBreak(),
 p("3. Text-to-speech with our cloned voices", H2),
 p("How voices are made today", H3),
 tbl([["Case", "Engine", "Issue"],
      ["English, cloned voice", "Pocket TTS (open source)", "Fast and usable; clone likeness is moderate."],
      ["Hindi / Hinglish, cloned voice", "Kokoro built-in Hindi voice, then OpenVoice v2 converts it to the person’s voice (two steps)", "About 1.6 s extra per sentence; first sound 0.93 s median, 2.77 s p95; tone and pitch drift; some words clipped or half-said; hiss at sentence ends."],
      ["Direct clone, English and Hindi", "Chatterbox Multilingual V3 (open source, MIT)", "Chosen as the fix: one pass, own voice, Hindi supported. Not running yet; needs a GPU to be fast live."],
      ["Fallback", "Kokoro", "Fixed voices only, no cloning."]], [42, 62, 72]),
 p("Why it does not match ElevenLabs yet", H3),
 *bl(["ElevenLabs uses one large model trained on emotion and Hindi-English mixing. Ours chains separate small models, so every hand-off adds delay and artefacts.",
      "Our voices have no emotion model. We added simple tags ([excited], [calm], [pause]) that change speed, pitch and pauses a little; this is delivery, not acting.",
      "Speed and pitch sliders (Studio and Voices page) work for cloned voices, but stretching audio always costs a little quality, so settings should stay small."]),
 p("What was fixed on 4 November", H3),
 *bl(["Speed and pitch settings saved per voice, applied in Studio, previews and live calls; Studio settings panel; emotion tags that are never spoken.",
      "Sentences are made three at a time so Hindi no longer waits on each conversion in turn; sentence splitting no longer breaks numbers like “1.5”.",
      "Clean sentence ends (short smooth fade). A harder tail trim was tried and removed because it hurt quality.",
      "<b>Not yet confirmed by listening or timing.</b> These changes still need an ear test and a re-run of the Hindi baseline."]),
 p("4. Better voices: options and drawbacks", H2),
 p("The ranking below is about likeness to ElevenLabs and fit with our rule that voices and text-to-speech must be open source. Prices and latencies are vendor or third-party figures and must be confirmed on the official pages before any decision.", SM),
 tbl([["Option", "Strengths", "Drawbacks if we use it"],
      ["<b>ElevenLabs</b> (Flash v2.5, v3)", "Best likeness and emotion; Hindi supported; first byte about 200 ms (third-party test); instant clone from 1 to 2 minutes of audio.", "Not open source (breaks our rule); cloud only; about $50 (Flash) to $100 (v3) per million characters (third-party figures); v3 is slower; voice recordings leave our control."],
      ["<b>Sarvam Bulbul v3</b>", "Built for Indian languages and Hindi-English mixing; vendor claims under 250 ms; 8 kHz phone output; consent-based cloning; says data stays in India.", "Not open source (breaks our rule); pricing figures conflict between sources; cloning is enterprise-gated; quality studies are published by Sarvam itself."],
      ["<b>Cartesia Sonic-3</b>", "Hindi voices; 90 to 166 ms first audio (sources differ); instant clone from about 10 s.", "Not open source; price not confirmed; Hindi clone quality unverified."],
      ["<b>Google Chirp 3 HD / Instant Custom Voice</b>", "Large vendor, stable; roughly $30 per million characters (older figure).", "Not open source; Hindi support for custom voices conflicts between document versions; clone access is gated."],
      ["<b>Chatterbox Multilingual V3</b> (our pick)", "Open source (MIT); Hindi and 22 other languages; clones from a short recording in one pass; no conversion step.", "Needs a GPU for live speed (about 1.7x real time on an Apple laptop, too slow for live calls); no per-phrase emotion control; Hindi accent can leak from the recording."],
      ["<b>IndicF5 / Dhee-Indic-F5</b>", "Strongest open Hindi cloning candidate found; trained on Indian languages.", "Licence is non-commercial (built on F5-TTS data under CC-BY-NC and IIT Madras data), so it cannot be used in a paid product without permission; GPU needed."],
      ["<b>Indic Parler-TTS</b>", "Apache 2.0; good Indian-language voices controlled by a text description.", "Cannot clone a specific person’s voice."],
      ["<b>CosyVoice 3</b>", "Open source, strong English and Chinese.", "Hindi support could not be confirmed (listed languages do not include Hindi); not recommended until proven."],
      ["<b>Kokoro</b> (kept as fallback)", "Tiny, fast, runs on CPU, open source.", "Fixed voices, no cloning."]], [34, 70, 72]),
 p("Recommendation", H3),
 *bl(["<b>Open-source path:</b> Chatterbox V3 for English and Hindi on a GPU server in India, Kokoro as fallback, plus a listening test with 20 real sentences against ElevenLabs. If Chatterbox is not close enough, ask for a licence for IndicF5 or fine-tune on our own recordings.",
      "<b>If the open-source rule can be relaxed for Hindi:</b> Sarvam Bulbul or ElevenLabs Flash would remove the two-step conversion today and give the fastest route to ElevenLabs-level likeness, at a per-character cost and with voice data in a vendor cloud. This is a policy decision, not a technical one."]),
 p("5. Other issues that need attention", H2),
 *bl(["<b>Privacy and consent.</b> Sarvam speech-to-text and OpenRouter send caller audio and text to third-party clouds. Cloned voice recordings are biometric data and must stay on controlled servers.",
      "<b>No GPU server yet.</b> Live-speed Chatterbox, a larger local AI model and the 0.8 s target all depend on one. Hosting inside India has not been chosen.",
      "<b>Phone line not measured.</b> Carrier delay (Plivo or Exotel, 8 kHz) must be timed with real calls; the numbers above exclude it.",
      "<b>Test realism.</b> All figures use scripted speech and repeated questions; a test with real callers, accents and noise is needed.",
      "<b>AI accuracy.</b> The invented-facts issue (prices, free trial) needs a fix on the AskG1 side or a stricter answer check before launch."]),
 p("Next steps, in order", H2),
 *bl(["Start Chatterbox; listening test against ElevenLabs on 20 English and Hindi sentences; decide the Hindi voice.",
      "Re-run the baseline with AskG1 warm; test ENDPOINTING_MS=250 with TURN_HOLD_MS=600; try a fast hosted open model.",
      "Choose and price a GPU server in India; time real phone calls."]),
 p("Sources for section 4: official and third-party pages for ElevenLabs, Sarvam, Cartesia, Google Cloud, Chatterbox, IndicF5 and Indic Parler-TTS were read on 4 November 2026; vendor figures are self-reported.", SM)]
SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=16*mm, bottomMargin=16*mm, title="Voice AI: latency, AI reply and voice quality").build(s, onFirstPage=foot, onLaterPages=foot)
print("wrote", OUT)
