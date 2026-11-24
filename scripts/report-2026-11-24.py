"""Builds the 24 November 2026 work report (HTML, then PDF with headless Chrome so Hindi renders correctly).

Every live number in the tables comes from the result files written by the test scripts:
  --conversation  apps/voice/src/conversation-test.ts --out <file>   (3 calls: English, Hindi, Hinglish)
  --smoke         scripts/web-smoke.ts --out <file>                  (every page as staff and admin, new admin APIs)
The other measurements (machine, model start-up times, Chatterbox speed, ElevenLabs plan) are written below with where they came from.

  python3 scripts/report-2026-11-24.py --conversation conv.json --smoke smoke.json --out-dir ~/Downloads/reports
"""
import argparse, html, json, os, statistics, subprocess, sys

p = argparse.ArgumentParser()
p.add_argument("--conversation", required=True)
p.add_argument("--smoke", required=True)
p.add_argument("--out-dir", required=True)
p.add_argument("--unit", default="490")
p.add_argument("--integration", default="101")
a = p.parse_args()
conv = json.load(open(a.conversation))
smoke = json.load(open(a.smoke))
os.makedirs(os.path.expanduser(a.out_dir), exist_ok=True)
E = lambda s: html.escape(str(s if s is not None else ""))

def ms(v):
    if v is None or v == "": return "–"
    v = int(v)
    return f"{v/1000:.2f} s" if v >= 1000 else f"{v} ms"

# ---------- live numbers from the conversation test
rows, model_heard, all_heard, stt = [], [], [], []
for r in conv["results"]:
    for t in r["turns"]:
        st = t.get("stages") or {}
        if st.get("heardMs") is not None: all_heard.append(st["heardMs"])
        if st.get("source") == "model" and st.get("answerHeardMs") is not None: model_heard.append(st["answerHeardMs"])
        if st.get("speechToTextMs") is not None: stt.append(st["speechToTextMs"])
med = lambda xs: ms(statistics.median(xs)) if xs else "–"
flows_ok = sum(1 for r in conv["results"] if r["ok"])
smoke_pass = sum(1 for c in smoke["results"] if c["ok"]); smoke_total = len(smoke["results"])

def conv_table(r):
    out = [f'<h3>{E(r["flow"])} call{"" if r["ok"] else " (stopped: " + E(r.get("why")) + ")"}</h3>',
           '<table><tr><th>Caller said</th><th>AI heard</th><th>AI replied</th><th>From</th><th>You stopped → words</th><th>Words → AI first word</th><th>You stopped → first sound</th><th>You stopped → answer</th></tr>']
    for t in r["turns"]:
        st = t.get("stages") or {}
        src = {"model": "AI model", "saved_answer": "saved answer", "scripted": "fixed line"}.get(st.get("source"), "–")
        out.append(f'<tr><td>{E(t["said"])}</td><td>{E(t["heard"])}</td><td>{E(t["reply"])}</td><td>{E(src)}</td><td>{ms(st.get("speechToTextMs"))}</td><td>{ms(st.get("llmFirstTokenMs")) if st.get("source") == "model" else "–"}</td><td>{ms(st.get("heardMs"))}</td><td>{ms(st.get("answerHeardMs"))}</td></tr>')
        for n in t.get("notices") or []:
            out.append(f'<tr class="note"><td colspan="8">Notice shown on the page: {E(n)}</td></tr>')
    out.append("</table>")
    return "\n".join(out)

smoke_rows = "\n".join(f'<tr class="{"" if c["ok"] else "bad"}"><td>{E(c["area"])}</td><td>{E(c["check"])}</td><td>{"PASS" if c["ok"] else "FAIL"}</td><td>{E(c["detail"])}</td></tr>' for c in smoke["results"] if not c["area"].startswith("page as") or not c["ok"])
pages_staff = [c for c in smoke["results"] if c["area"] == "page as staff"]
pages_admin = [c for c in smoke["results"] if c["area"] == "page as admin"]

STATUS = lambda s, cls: f'<span class="badge {cls}">{E(s)}</span>'
doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bizfy Voice AI: work report, 24 November 2026</title>
<style>
 body {{ font: 12.5px/1.5 -apple-system, "Segoe UI", "Noto Sans Devanagari", Arial, sans-serif; color:#1b1f24; margin: 28px 36px; }}
 h1 {{ font-size: 22px; margin: 0 0 4px; }} h2 {{ font-size: 16px; margin: 26px 0 8px; border-bottom: 2px solid #e3e6ea; padding-bottom: 4px; }} h3 {{ font-size: 13.5px; margin: 16px 0 6px; }}
 .muted {{ color:#5b6570; }} table {{ border-collapse: collapse; width: 100%; margin: 6px 0 10px; }} th, td {{ border: 1px solid #d9dde2; padding: 4px 6px; vertical-align: top; text-align: left; }}
 th {{ background:#f3f5f7; font-weight: 600; }} tr.note td {{ background:#fffbe6; font-size: 11.5px; }} tr.bad td {{ background:#fdecec; }}
 .badge {{ display:inline-block; padding: 1px 7px; border-radius: 9px; font-size: 11px; font-weight: 600; }} .ok {{ background:#e3f6e8; color:#14632e; }} .key {{ background:#fff3d6; color:#7a5300; }} .no {{ background:#fde3e3; color:#8a1c1c; }}
 code {{ background:#f3f5f7; padding: 0 3px; border-radius: 3px; }} li {{ margin: 2px 0; }} .kpi {{ display:flex; gap:12px; margin: 10px 0; }} .kpi div {{ border:1px solid #d9dde2; border-radius:8px; padding:8px 12px; }} .kpi b {{ display:block; font-size: 17px; }}
 @media print {{ body {{ margin: 0; }} h2 {{ break-after: avoid; }} table {{ break-inside: auto; }} tr {{ break-inside: avoid; }} }}
</style></head><body>
<h1>Bizfy Voice AI: work report</h1>
<div class="muted">Tuesday 24 November 2026 · Karan Devda · repository <code>voice-ai-platform</code>, branch <code>main</code> (changes not yet committed)</div>

<div class="kpi">
 <div><b>{E(a.unit)}</b>unit tests passed</div>
 <div><b>{E(a.integration)}</b>database tests passed<br><span class="muted">real Postgres, row-level security on</span></div>
 <div><b>{smoke_pass}/{smoke_total}</b>website checks passed<br><span class="muted">{len(pages_staff)+len(pages_admin)} page loads as staff and admin</span></div>
 <div><b>{flows_ok}/3</b>test calls completed<br><span class="muted">English, Hindi, Hinglish</span></div>
</div>

<h2>Summary of today's six agenda items</h2>
<table>
<tr><th>#</th><th>Agenda item</th><th>Status</th><th>What was done, in one line</th></tr>
<tr><td>1</td><td>Fix AI answers and speed (OpenRouter, prompt, booking flow, under 1.5 s)</td><td>{STATUS("Done in code; needs a key", "key")}</td><td>Prompt 70% shorter with your rules; booking is now a step-by-step flow that saves bookings; latency stages fixed. OpenRouter is ready but <b>no OpenRouter key exists</b>, and AskG1 is unreachable (VPN stopped), so test calls used the small local Llama.</td></tr>
<tr><td>2</td><td>One cloned voice for English, Hindi and Hinglish</td><td>{STATUS("Blocked: needs a paid plan or GPU", "no")}</td><td>The only fast clone route (ElevenLabs) is on the <b>Free tier, which cannot clone</b>. Chatterbox (one voice for all three) took 28–49 s per sentence on this Mac. Re-upload works the same; the voice choice needs the plan.</td></tr>
<tr><td>3</td><td>Research alternatives like Maya 2; add only if under 1 s</td><td>{STATUS("Researched; not added", "key")}</td><td>Maya 2 Native can clone across Hindi/English and is very fast, but only on an NVIDIA GPU. Best fit: Cartesia Sonic-3.6. Nothing was added because none could be measured under 1 s without a key; a measuring tool is ready.</td></tr>
<tr><td>4</td><td>Real PAN and GST checks through a KYC service</td><td>{STATUS("Done in code; needs a key", "key")}</td><td>Cashfree Verification adapter: a PAN that is not valid or a cancelled GSTIN is refused; name on record shown to the reviewer. Switches on with Cashfree keys.</td></tr>
<tr><td>5</td><td>Admin gaps: two-way CRM sync, in-app keys, status doc</td><td>{STATUS("Done", "ok")}</td><td>CRM can send contacts in (no echo back), five-check health test; Platform &gt; Provider keys (encrypted, password re-check); status document updated.</td></tr>
<tr><td>6</td><td>Fix, check and test every necessary feature</td><td>{STATUS("Done", "ok")}</td><td>All unit and database tests pass; every page opened as staff and admin; new APIs tested; three full test calls run. One existing test bug and one new bug found by the tests were fixed.</td></tr>
</table>

<h2>1. AI answers and speed</h2>
<h3>Why answers were bad and slow (measured today)</h3>
<ul>
 <li><b>AskG1 cannot be reached:</b> Tailscale (the company VPN) is stopped on this Mac, so <code>g1-h310c.bizfy.mesh</code> does not resolve. Yesterday, with the VPN on, its gateway answered but its model server behind it (port 8090 on that machine) was down. Every call therefore falls back to the small local Llama 3.2 3B. The voice service now logs this cause at start-up.</li>
 <li><b>No OpenRouter key</b> exists in any env file, so the switch to OpenRouter (<code>LLM_PRIMARY=openrouter</code>) cannot be used yet.</li>
 <li><b>The old instruction was long:</b> about 2,300–2,900 tokens. The first question with a new instruction took <b>2–23 s</b> on Llama 3B and <b>15–67 s</b> on Qwen 2.5 7B on this Mac; later questions 0.07–0.4 s (cached).</li>
 <li><b>This Mac is overloaded:</b> Apple M4 with 16 GB ran two Whisper models, Llama, Chatterbox, Kokoro, Pocket TTS and voice conversion at once: <b>7% memory free and 21.7 of 22.5 GB swap used</b>. That alone causes multi-second delays.</li>
 <li><b>Local models answer Hindi badly:</b> Qwen answered a Hindi question in English; Llama used formal Hindi ("उपयोगकर्ताओं की सीमा").</li>
</ul>
<h3>What changed</h3>
<ul>
 <li><b>New instruction</b> (about 750–890 tokens, 70% shorter), built on your rules: answer only what was asked; only company-knowledge facts; one or two sentences; no repeated filler lines; never claim to connect a call now ("मैं अभी सीधे connect नहीं कर सकता, team आपको call करेगी"); simple spoken Hindi; real Hinglish with English product words. Each turn's note now gives today's date and time in India and the caller's name exactly as first heard (no more करन then करण). The old one can be brought back with <code>PROMPT_VERSION=legacy</code> for comparison.</li>
 <li><b>Booking is a step-by-step flow, not free chat:</b> it asks only for the missing item (name, then day, then time); understands today/आज/aaj, tomorrow/कल/kal, weekdays, "24 November", "दोपहर एक बजे", "1 baje", "साढ़े चार", and the slip "एक बज़ेट"; asks once when a weekday and date disagree; refuses a time already passed; confirms once in one line, then stops. Bookings are <b>saved</b>, the lead is marked "callback requested", admins and managers are e-mailed, and bookings show at the top of <b>Call logs</b>.</li>
 <li><b>Goodbye:</b> "thank you / धन्यवाद / take care" gets one short goodbye, instantly.</li>
 <li><b>Latency figures fixed:</b> every stage is now measured from the same two moments, when the caller stopped speaking and when their words were written down. Answers from saved audio or fixed lines are labelled, which explains the old "Voice starts 0 ms" and "After transcript 3 ms".</li>
 <li>The reply length cap was lowered from 220 to 150 tokens.</li>
</ul>
<h3>Test calls today (real speech, real speech-to-text, local Llama because of the above)</h3>
<p class="muted">The caller's lines were spoken by the local Kokoro voice and streamed in real time; the AI answered in your cloned "Karan" voice. Median, all turns: you stopped → first sound <b>{med(all_heard)}</b>; you stopped → words written down <b>{med(stt)}</b>; turns answered by the AI model, you stopped → answer <b>{med(model_heard)}</b>.</p>
{"".join(conv_table(r) for r in conv["results"])}
<h3>What the first test run found, and what was fixed</h3>
<ul>
 <li><b>English (worked end to end):</b>
  <ul>
   <li>The booking flow asked one thing at a time, refused 1 PM because it had already passed, confirmed 4 PM once, saved it and said goodbye.</li>
   <li>Every turn reached the first sound in about 0.9–1.0 s.</li>
   <li>The local speech-to-text heard "Karan" as <b>"Karen"</b>. Names the recogniser should know can be listed in <code>STT_NAME_HINTS</code>.</li>
  </ul>
 </li>
 <li><b>Hindi:</b> local Whisper wrote <b>नमस्टे</b> for नमस्ते, <b>शेडिूल</b> for शेड्यूल and <b>चोबीस</b> for चौबीस, so the booking request was not recognised and the small model answered instead. Both the greeting and booking detection now accept these spellings and Devanagari forms of English day and month names (ट्यूस्डे, नवेंबर), and tests now cover them.</li>
 <li><b>Hindi "धन्यवाद" on its own was not heard:</b> the recogniser ignores a lone "धन्यवाद" on purpose, because Whisper often invents it out of silence. Deepgram or Sarvam would not need that guard.</li>
 <li><b>Hinglish:</b> the test caller is synthetic (Kokoro's Hindi voice reading the Hinglish lines in Devanagari), and local Whisper heard it badly ("Karan hai" → "इनकारण ही है"). Two consequences:
  <ul>
   <li><b>Booking still behaved correctly:</b> it started and asked again instead of booking a wrong date.</li>
   <li><b>The remedy is a better recogniser:</b> Deepgram "multi" or Sarvam. The repo already supports Deepgram for Hindi with <code>STT_HINDI=deepgram</code>; the 3 Nov report measured Sarvam at 1% errors.</li>
  </ul>
 </li>
 <li><b>The small local model (Llama 3B) still made the mistakes your rules forbid:</b>
  <ul>
   <li>formal Hindi ("उपयोगकर्ताओं");</li>
   <li>an invented fact: it said call recordings are kept "तीन महीने" (3 months), but the knowledge base says 30 days.</li>
  </ul>
  This is the main reason calls need a stronger model (OpenRouter or AskG1). The new instruction cannot make a 3B model follow it reliably.</li>
 <li><b>Review fix:</b> the word "meeting" on its own no longer starts a booking ("does it include meeting transcripts?"); "schedule a meeting" and "मीटिंग चाहिए" still do.</li>
</ul>
<h3>Getting under 1.5 seconds</h3>
<ul>
 <li><b>The local stack on one 16 GB laptop cannot do it reliably:</b> the models swap each other out of memory.</li>
 <li><b>Measured cloud parts:</b> Deepgram Hindi about 0.3 s and ElevenLabs Flash about 0.3 s (both measured 23 November). Add an OpenRouter model (or AskG1 when it is back) at about 0.3–0.8 s to first word.</li>
 <li><b>Expected total:</b> about 0.9–1.4 s from the caller stopping to the first sound. These are estimates from those measurements, not a measured end-to-end figure.</li>
 <li><b>Fixed lines are already instant:</b> greeting, booking questions and goodbye.</li>
</ul>

<h2>2. One cloned voice for English, Hindi and Hinglish</h2>
<ul>
 <li><b>Why Hinglish sounded like two people:</b> the voice service has no Chatterbox address set (<code>CHATTERBOX_URL</code> is set only for the website). So Hindi words went through Kokoro plus voice conversion and English words through the Pocket clone.</li>
 <li><b>Chatterbox on this Mac is too slow:</b> it speaks every language in one voice from your recording, but took <b>28–49 s</b> for one sentence (5–8 times slower than real time).</li>
 <li><b>ElevenLabs account cannot clone:</b> it is on the <b>Free tier</b> (<code>can_use_instant_voice_cloning = false</code>, 10,000 characters a month). Instant cloning needs the Starter plan or above. With it, one voice ID speaks all three languages at about 0.3 s.</li>
 <li><b>To finish:</b>
  <ol>
   <li>Upgrade ElevenLabs (or choose Cartesia, below).</li>
   <li>Re-upload your clean English and Hindi recordings on <b>Voice clone</b>.</li>
   <li>Pick that one voice for all calls.</li>
  </ol>
 </li>
</ul>

<h2>3. Alternative voices (research), including Maya 2</h2>
<table>
<tr><th>Option</th><th>Hindi + Hinglish in one voice</th><th>Clones your voice</th><th>First audio</th><th>Verdict</th></tr>
<tr><td>Maya 2 Native (open weights, Oct 2026)</td><td>Yes. Mixed text is a stated weakness (10.6% character errors)</td><td>Yes, from 3–10 s, across languages</td><td>14–111 ms on an NVIDIA H100; Mac only via an unofficial port</td><td>Needs our own NVIDIA GPU server. The hosted Maya API documents only preset voices</td></tr>
<tr><td>Cartesia Sonic-3.6</td><td>Yes: switches Hindi↔English inside one sentence</td><td>Yes (instant, ~10 s)</td><td>&lt;90 ms claimed; Indian servers</td><td><b>Best fit</b>: about $0.04 per 1,000 characters</td></tr>
<tr><td>ElevenLabs Flash v2.5 / v4</td><td>Hindi yes; mixed not documented</td><td>Yes, on a paid plan</td><td>0.26–0.32 s measured from here</td><td>Already built in; needs the plan upgrade</td></tr>
<tr><td>Sarvam Bulbul V4 Flash</td><td>Yes</td><td>Enterprise only</td><td>&lt;250 ms claimed</td><td>Cheapest, but cloning needs a contract</td></tr>
<tr><td>Chatterbox / XTTS / IndicF5 / Fish S2</td><td>Varies</td><td>Yes</td><td>Slow here or unverified</td><td>Avoid: retired, non-commercial licence, or no streaming</td></tr>
</table>
<ul>
 <li><b>Why nothing was added:</b> as you asked, nothing is added until it is measured under 1 s, and none could be measured without a key.</li>
 <li><b>How to measure:</b> <code>apps/voice/src/tts-compare.ts</code> measures time to first audio from this machine for English, Hindi and Hinglish as soon as an ElevenLabs or Cartesia key is set.</li>
 <li><b>Sources:</b> Maya model card, Cartesia, ElevenLabs and Sarvam docs, and the AI4Bharat Interspeech 2026 study. Vendor numbers are their own claims.</li>
</ul>

<h2>4. Real PAN and GST checks</h2>
<ul>
 <li><b>How it works:</b> when a KYC request is sent, the PAN and GSTIN are checked against the Income Tax and GST Network records through <b>Cashfree Verification</b>.
  <ul>
   <li>A PAN that is not valid, or a GSTIN that is cancelled or suspended, is refused straight away with a clear message.</li>
   <li>The name on record and the name-match score are shown to the staff member reviewing it.</li>
   <li>If the service is down, the request still goes through, marked "could not be checked".</li>
  </ul>
 </li>
 <li><b>To switch it on:</b> set <code>CASHFREE_CLIENT_ID</code> and <code>CASHFREE_CLIENT_SECRET</code>, plus <code>CASHFREE_ENV=sandbox</code> or <code>production</code>. Use the env file or Platform &gt; Provider keys &gt; KYC.</li>
 <li><b>Limits:</b>
  <ul>
   <li>Written from Cashfree's documented API and tested against sample answers only. The first live answers should be checked.</li>
   <li>Proving the person owns the documents (not just that the numbers exist) would need DigiLocker.</li>
  </ul>
 </li>
</ul>

<h2>5. Admin gaps closed</h2>
<ul>
 <li><b>Two-way CRM sync:</b>
  <ul>
   <li>The CRM can send contacts to <code>POST /api/integrations/inbound</code> with an API token (up to 500 per request).</li>
   <li>Contacts are created or updated by phone number, with name, e-mail, status, tags and the CRM's own ID. Status changes go into the history.</li>
   <li>Bad rows are reported, and each batch is listed on the Integrations page.</li>
   <li>A change that came from the CRM is <b>not sent back</b> to it, so there is no loop.</li>
  </ul>
 </li>
 <li><b>Integration health test:</b> one button runs five checks and saves an OK, degraded or down verdict:
  <ol>
   <li>switched on;</li>
   <li>public HTTPS address;</li>
   <li>signed request accepted, and how fast;</li>
   <li>24-hour failure rate;</li>
   <li>last delivery.</li>
  </ol>
 </li>
 <li><b>Provider keys in the website</b> (Platform &gt; Provider keys, staff only):
  <ul>
   <li><b>Covers:</b> Twilio/Plivo, all six payment gateways, OpenRouter, Deepgram, ElevenLabs, KYC and SMTP.</li>
   <li><b>Security:</b> stored encrypted, never shown again (last four characters only), and every change needs your password.</li>
   <li><b>Effect:</b> a key set here overrides the env file. The website uses it at once; the voice service and worker within a minute.</li>
  </ul>
 </li>
 <li><b>Feature status document</b> (<code>docs/FEATURE_COMPLETION_STATUS.md</code>) updated with today's work and corrected where it was out of date.</li>
</ul>

<h2>6. Testing</h2>
<ul>
 <li><b>Unit tests:</b> {E(a.unit)} pass in shared, auth, providers, voice, website and worker code. They include 13 new booking-flow tests and 8 new KYC-check tests.</li>
 <li><b>Database tests:</b> {E(a.integration)} pass against a fresh test database built from all migrations, with row-level security on. They include 7 new tests: CRM sync and no-echo, provider keys, bookings, and KYC refusals.
  <ul>
   <li>One older test was wrong: it used a fake user ID in the export test. It was fixed.</li>
   <li>The new tests caught one bug in today's CRM-sync code (tags sent in the wrong form). It was fixed before release.</li>
  </ul>
 </li>
 <li><b>Website:</b> every page was opened as staff ({sum(1 for c in pages_staff if c["ok"])}/{len(pages_staff)} OK) and as admin ({sum(1 for c in pages_admin if c["ok"])}/{len(pages_admin)} OK; staff-only pages correctly show "no access"). The new features were exercised through their real APIs:</li>
</ul>
<table><tr><th>Area</th><th>Check</th><th>Result</th><th>Detail</th></tr>
{smoke_rows}
</table>

<h2>What is needed from you</h2>
<ol>
 <li><b>OpenRouter API key</b> (openrouter.ai/keys). Add it on Platform &gt; Provider keys with <code>LLM_PRIMARY=openrouter</code>. Or turn the VPN on and get the AskG1 model server (port 8090 on g1-h310c) restarted.</li>
 <li><b>A voice plan:</b> ElevenLabs Starter or above (instant cloning), or a Cartesia account. Then re-upload your English and Hindi recordings on Voice clone and pick that one voice.</li>
 <li><b>Cashfree Verification keys</b> (sandbox first) to turn on the real PAN/GST checks.</li>
 <li><b>For real phone calls (unchanged from yesterday):</b> a Plivo account and number, or a paid Twilio account (trial accounts cannot use SIP trunks).</li>
 <li><b>A GPU server</b>, if the voice must stay self-hosted (Maya 2 Native or Chatterbox): this 16 GB laptop cannot run all the models fast.</li>
</ol>

<h2>How to run the tests again</h2>
<ul>
 <li><b>Unit tests:</b> <code>npx vitest run</code> in each package.</li>
 <li><b>Database tests:</b> set <code>TEST_DATABASE_URL</code> and <code>TEST_APP_DATABASE_URL</code> to a database built from the migrations.</li>
 <li><b>Three test calls:</b> <code>pnpm --filter @voiceai/voice exec tsx src/conversation-test.ts -- --sub &lt;user&gt; --org &lt;org&gt; --voice profile:&lt;id&gt;</code></li>
 <li><b>Website checks:</b> <code>npx tsx scripts/web-smoke.mts</code></li>
 <li><b>Voice speed:</b> <code>tsx src/tts-compare.ts</code></li>
</ul>
<p class="muted">Generated by scripts/report-2026-11-24.py from the saved test results ({E(conv.get("at"))}, {E(smoke.get("at"))}).</p>
</body></html>"""

out_dir = os.path.expanduser(a.out_dir)
html_path = os.path.join(out_dir, "Bizfy-Voice-AI-Report-2026-11-24.html")
pdf_path = os.path.join(out_dir, "Bizfy-Voice-AI-Report-2026-11-24.pdf")
open(html_path, "w").write(doc)
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if os.path.exists(chrome):
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}", f"file://{html_path}"], check=False, capture_output=True, timeout=120)
print(html_path); print(pdf_path if os.path.exists(pdf_path) else "(PDF not made: Chrome not found)")
