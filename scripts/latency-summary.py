#!/usr/bin/env python3
"""p50/p95 per stage from load-test --json files; report SOP first-audio and actual-answer targets separately."""
import json, sys, statistics
def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(p / 100 * len(xs)))] if xs else float("nan")
FIRST_P50, FIRST_P95, ANSWER_P50 = 1000, 1500, 1000
for path in sys.argv[1:]:
    rows = json.load(open(path))
    if not rows: print(path, "no answers"); continue
    stt = [r["firstWordMs"] - r["totalMs"] for r in rows]                     # end of speech -> text is final (endpointing + speech-to-text + network)
    llm = [r["llmFirstTokenMs"] for r in rows]                                  # final text -> AI's first word (includes knowledge search)
    ground = [r.get("groundMs", 0) for r in rows]
    tts = [r["ttsFirstAudioMs"] for r in rows]                                  # first sentence sent to voice -> first audio
    first = [r["firstWordMs"] for r in rows]                                    # caller stops -> first sound (may be the instant "Sure.")
    real = [r["firstWordMs"] - r["totalMs"] + r["answerMs"] for r in rows if r.get("answerMs")]  # caller stops -> the real answer
    print(f"\n== {path}  ({len(rows)} answers)")
    print(f"{'stage':<46}{'p50':>8}{'p95':>8}")
    for name, xs in [("end of speech -> text final (endpoint+STT)", stt), ("AI first word (LLM)", llm), ("  of which knowledge search", ground), ("first sentence -> first audio (TTS)", tts),
                     ("caller stops -> first sound", first), ("caller stops -> REAL answer", real)]:
        print(f"{name:<46}{pct(xs,50)/1000:>7.2f}s{pct(xs,95)/1000:>7.2f}s")
    first_ok = pct(first, 50) <= FIRST_P50 and pct(first, 95) <= FIRST_P95
    print(f"SOP first-audio target (p50 <= 1.0 s, p95 <= 1.5 s): {'MET' if first_ok else 'NOT MET'}")
    print(f"Real-answer target (p50 < 1.0 s): {'MET' if pct(real, 50) < ANSWER_P50 else 'NOT MET'}")
print("\nNot measured here: the phone line (carrier) -- needs real Plivo/Exotel calls.")
