// GrindGuard verification orchestrator. Shared by the local server and the
// Vercel serverless function so both paths run the same code.

import {
  fetchSitePage,
  checkSite,
  checkTeam,
  checkContract,
  checkToken,
  checkHiddenCosts,
  checkMarketing,
  checkDomainAge,
  checkSocial,
  checkFaucet,
  checkPayout,
} from "./checks.mjs";
import { scoreChecks, verdictFor, verdictText } from "./score.mjs";
import { synthesize } from "./llm.mjs";

const CHAINS = ["ethereum", "bsc", "polygon", "base", "arbitrum"];

export function normalizeInput(body) {
  if (!body || typeof body !== "object") throw new Error("Request body must be a JSON object.");
  const url = String(body.url || "").trim();
  if (!url) throw new Error("Field 'url' is required.");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Field 'url' is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Field 'url' must start with http:// or https://.");
  }
  const contractAddress = body.contractAddress ? String(body.contractAddress).trim() : "";
  if (contractAddress && !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error("Field 'contractAddress' must be a 0x address with 40 hex characters.");
  }
  const chain = CHAINS.includes(body.chain) ? body.chain : "ethereum";
  return { url: parsed.href, contractAddress, chain };
}

export async function runVerification(input) {
  const startedAt = new Date().toISOString();
  const page = await fetchSitePage(input.url);
  const site = await checkSite(input, page);
  const contract = await checkContract(input);
  const [team, token, hiddenCosts, marketing, domainAge, social, faucet, payout] = await Promise.all([
    checkTeam(input, page),
    checkToken(input),
    checkHiddenCosts(input, page),
    checkMarketing(input, page, contract),
    checkDomainAge(input),
    checkSocial(input, page),
    checkFaucet(input, page),
    checkPayout(input, page),
  ]);
  const checks = [site, team, contract, token, hiddenCosts, marketing, domainAge, social, faucet, payout]
    .sort((a, b) => a.id - b.id);
  const score = scoreChecks(checks);
  const verdict = verdictFor(checks, score);
  const llm = await synthesize(checks, verdict, score);
  return {
    input,
    generatedAt: startedAt,
    finishedAt: new Date().toISOString(),
    checks,
    score,
    verdict,
    verdictNote: verdictText(verdict),
    llm,
  };
}
