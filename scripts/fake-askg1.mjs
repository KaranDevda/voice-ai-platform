// DEMO / TEST STAND-IN for AskG1. It is NOT the real AI: it answers only questions about the business and premium
// plan prices, in English or Hindi, from fixed text, after FIRST_TOKEN_MS to mimic a model's start-up time.
// Use it only when the real AskG1 is unreachable, and say so out loud when demonstrating.
import http from "node:http";

const PORT = Number(process.env.PORT ?? 8099);
const FIRST = Number(process.env.FIRST_TOKEN_MS ?? 350);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPLIES = {
  en: {
    premium: "The premium plan costs nine thousand nine hundred ninety nine rupees per month. It includes priority support and unlimited calls. Would you like to hear more?",
    default: "Sure. The business plan costs four thousand nine hundred ninety nine rupees per month. You can change or cancel it at any time. Would you like me to send the details?",
  },
  hi: {
    premium: "प्रीमियम प्लान की कीमत नौ हज़ार नौ सौ निन्यानवे रुपये प्रति माह है। इसमें प्राथमिकता सहायता और असीमित कॉल शामिल हैं। क्या आप और जानना चाहेंगे?",
    default: "जी हाँ। बिज़नेस प्लान की कीमत चार हज़ार नौ सौ निन्यानवे रुपये प्रति माह है। आप इसे कभी भी बदल या रद्द कर सकते हैं। क्या मैं आपको विवरण भेज दूँ?",
  },
};

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    if (req.url !== "/v1/chat/completions") { res.writeHead(200); return res.end("stand-in AskG1 (not the real AI)"); }
    const { messages } = JSON.parse(body);
    const said = messages.at(-1).content;
    const lang = /[ऀ-ॿ]/.test(said) ? "hi" : "en";
    const reply = /premium|प्रीमियम/i.test(said) ? REPLIES[lang].premium : REPLIES[lang].default;
    res.writeHead(200, { "content-type": "text/event-stream" });
    await sleep(FIRST);
    for (const piece of reply.split(/(?<= )/)) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`); await sleep(25); }
    res.end("data: [DONE]\n\n");
  });
}).listen(PORT, "127.0.0.1", () => console.log(`STAND-IN AskG1 (not the real AI) on :${PORT}`));
