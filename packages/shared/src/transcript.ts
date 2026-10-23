export interface TranscriptLine { speaker: number; startMs: number; endMs: number; text: string }

export const speakerName = (n: number) => `Speaker ${n + 1}`;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 00:01:02,345, the SubRip timestamp format. */
export function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor((t % 3_600_000) / 60_000))}:${pad(Math.floor((t % 60_000) / 1000))},${pad(t % 1000, 3)}`;
}

export function toSrt(lines: TranscriptLine[], withSpeakers = true): string {
  return lines
    .map((l, i) => {
      const end = Math.max(l.endMs, l.startMs + 500); // players ignore cues that end before they start
      return `${i + 1}\n${srtTime(l.startMs)} --> ${srtTime(end)}\n${withSpeakers ? `${speakerName(l.speaker)}: ` : ""}${l.text}\n`;
    })
    .join("\n");
}

/** Plain text; speaker labels appear only when the speaker changes. */
export function toPlainText(lines: TranscriptLine[]): string {
  const speakers = new Set(lines.map((l) => l.speaker));
  if (speakers.size <= 1) return lines.map((l) => l.text).join("\n");
  let last = -1;
  return lines.map((l) => { const head = l.speaker !== last ? `${last === -1 ? "" : "\n"}${speakerName(l.speaker)}:\n` : ""; last = l.speaker; return `${head}${l.text}`; }).join("\n");
}

/** Index of the line playing at `ms`, or the last one that started before it, or -1. */
export function activeLine(lines: TranscriptLine[], ms: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i]!.startMs <= ms) idx = i; else break; }
  return idx;
}
