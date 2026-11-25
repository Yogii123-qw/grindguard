// GrindGuard scoring: weights per check, points per status, verdict rules.
// Verdict is deterministic. The LLM never changes it; it only writes a summary.

export const WEIGHTS = {
  1: 15,
  2: 10,
  3: 15,
  4: 10,
  5: 10,
  6: 10,
  7: 10,
  8: 10,
  9: 5,
  10: 5,
};

const POINTS = { pass: 1, warn: 0.5, unknown: 0.5, fail: 0 };

export function scoreChecks(checks) {
  let earned = 0;
  let total = 0;
  for (const c of checks) {
    const w = WEIGHTS[c.id] || 0;
    total += w;
    earned += w * (POINTS[c.status] ?? 0);
  }
  return total === 0 ? 0 : Math.round((earned / total) * 100);
}

export function verdictFor(checks, score) {
  const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
  if (checks.some((c) => c.status === "fail")) return "SKIP";
  if (byId[1] === "unknown" || byId[3] === "unknown" || byId[4] === "unknown") return "CAUTION";
  if (score < 70) return "CAUTION";
  return "GRIND";
}

export function verdictText(verdict) {
  if (verdict === "GRIND") return "Checks passed. This program looks worth the time. Verify the payout claim yourself before spending money.";
  if (verdict === "CAUTION") return "Some checks are unclear or weak. Proceed only after reading the flagged evidence.";
  return "One or more checks failed. Do not spend time or money on this program until the failure is explained.";
}
