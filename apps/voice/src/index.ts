import express from "express";

// Phase 2: Plivo bidirectional stream (ws) -> STT -> AskG1 -> TTS loop with barge-in.
const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => console.log(`voice service listening on :${port}`));
