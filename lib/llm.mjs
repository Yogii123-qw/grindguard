// GrindGuard LLM synthesis. Optional by design.
// The verdict is computed by lib/score.mjs and never changes here.
// Without GROQ_API_KEY the function reports that no key is configured and
// returns no text. It never invents results.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

export async function synthesize(checks, verdict, score) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return {
      available: false,
      reason: "No GROQ_API_KEY is configured, so no AI synthesis ran. The verdict above is purely rule based.",
      text: null,
      model: null,
    };
  }
  const summary = checks
    .map((c) => `#${c.id} ${c.name}: ${c.status.toUpperCase()}. ${c.evidence}`)
    .join("\n");
  const body = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content: "You summarize verification results for a crypto airdrop program. Use only the check data given. Do not invent facts, numbers, or claims. Write at most 3 short sentences in plain technical English. No em dashes. No marketing words.",
      },
      {
        role: "user",
        content: `Verdict: ${verdict}. Score: ${score}/100.\n${summary}\nWrite the summary.`,
      },
    ],
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return { available: false, reason: `Groq request failed with HTTP ${res.status}. The verdict above is purely rule based.`, text: null, model: null };
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || "").trim()
      : "";
    if (!text) {
      return { available: false, reason: "Groq returned an empty summary. The verdict above is purely rule based.", text: null, model: null };
    }
    return { available: true, reason: null, text, model: MODEL };
  } catch (err) {
    return { available: false, reason: `Groq request failed: ${String(err.message || err).slice(0, 100)}. The verdict above is purely rule based.`, text: null, model: null };
  }
}
