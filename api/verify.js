// Vercel serverless handler. Same verification code as the local server.
import { normalizeInput, runVerification } from "../lib/verify.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }
  let input;
  try {
    input = normalizeInput(req.body);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }
  try {
    const report = await runVerification(input);
    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
