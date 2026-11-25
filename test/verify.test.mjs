// GrindGuard tests. Unit tests always run. Live tests run only with
// RUN_LIVE=1 because they call public endpoints.

import test from "node:test";
import assert from "node:assert/strict";
import { scoreChecks, verdictFor } from "../lib/score.mjs";
import { normalizeInput } from "../lib/verify.mjs";
import { programNameFromUrl } from "../lib/checks.mjs";

test("programNameFromUrl: takes the registrable domain label", () => {
  assert.equal(programNameFromUrl("https://app.orbinum.network/"), "orbinum");
  assert.equal(programNameFromUrl("https://www.ammora.io/"), "ammora");
  assert.equal(programNameFromUrl("https://example.com/"), "example");
  assert.equal(programNameFromUrl("https://flop.network/"), "flop");
  assert.equal(programNameFromUrl("not a url"), "");
});

function checksWith(overrides) {
  const base = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, status: "pass" }));
  for (const [id, status] of Object.entries(overrides)) base[Number(id) - 1].status = status;
  return base;
}

test("scoring: all pass is 100 and GRIND", () => {
  const checks = checksWith({});
  assert.equal(scoreChecks(checks), 100);
  assert.equal(verdictFor(checks, 100), "GRIND");
});

test("scoring: one fail means SKIP", () => {
  const checks = checksWith({ 1: "fail" });
  assert.equal(verdictFor(checks, scoreChecks(checks)), "SKIP");
  const contractFail = checksWith({ 3: "fail" });
  assert.equal(verdictFor(contractFail, scoreChecks(contractFail)), "SKIP");
});

test("scoring: unknown on site, contract, or token means CAUTION", () => {
  for (const id of [1, 3, 4]) {
    const checks = checksWith({ [id]: "unknown" });
    assert.equal(verdictFor(checks, scoreChecks(checks)), "CAUTION");
  }
});

test("scoring: score below 70 means CAUTION", () => {
  const checks = checksWith({ 2: "warn", 4: "warn", 5: "warn", 6: "warn", 7: "warn", 8: "warn", 9: "warn", 10: "warn" });
  const score = scoreChecks(checks);
  assert.ok(score < 70, `expected score below 70, got ${score}`);
  assert.equal(verdictFor(checks, score), "CAUTION");
});

test("scoring: exactly 70 with no fail and no material unknown is GRIND", () => {
  // warn on 2, 5, 6, 7, 8, 9, 10: weights 10+10+10+10+10+5+5 = 60, lost 30 -> 70.
  const checks = checksWith({ 2: "warn", 5: "warn", 6: "warn", 7: "warn", 8: "warn", 9: "warn", 10: "warn" });
  const score = scoreChecks(checks);
  assert.equal(score, 70);
  assert.equal(verdictFor(checks, score), "GRIND");
});

test("scoring: warn on non-material checks keeps GRIND when score is high", () => {
  const checks = checksWith({ 7: "warn" });
  assert.equal(scoreChecks(checks), 95);
  assert.equal(verdictFor(checks, 95), "GRIND");
});

test("normalizeInput: rejects bad input", () => {
  assert.throws(() => normalizeInput(null), /JSON object/);
  assert.throws(() => normalizeInput({}), /url/);
  assert.throws(() => normalizeInput({ url: "not a url" }), /valid URL/);
  assert.throws(() => normalizeInput({ url: "ftp://example.com" }), /http/);
  assert.throws(() => normalizeInput({ url: "https://example.com", contractAddress: "0x123" }), /40 hex/);
});

test("normalizeInput: accepts valid input and defaults the chain", () => {
  const input = normalizeInput({ url: "https://example.com", contractAddress: "0x55d398326f99059fF775485246999027B3197955" });
  assert.equal(input.url, "https://example.com/");
  assert.equal(input.chain, "ethereum");
  assert.equal(normalizeInput({ url: "https://example.com", chain: "bsc" }).chain, "bsc");
});

const LIVE = process.env.RUN_LIVE === "1";

test("live: example.com verifies with a pass on site and domain age", { skip: !LIVE }, async () => {
  const { runVerification } = await import("../lib/verify.mjs");
  const report = await runVerification({ url: "https://example.com/", contractAddress: "", chain: "ethereum" });
  assert.equal(report.checks.length, 10);
  assert.equal(report.checks[0].status, "pass");
  assert.ok(report.score >= 0 && report.score <= 100);
  assert.ok(["GRIND", "CAUTION", "SKIP"].includes(report.verdict));
});

test("live: private addresses are refused, never fetched", { skip: !LIVE }, async () => {
  const { runVerification } = await import("../lib/verify.mjs");
  const report = await runVerification({ url: "http://127.0.0.1:3000/", contractAddress: "", chain: "ethereum" });
  assert.equal(report.checks[0].status, "fail");
  assert.match(report.checks[0].evidence, /private address/);
  const meta = await runVerification({ url: "http://169.254.169.254/latest/meta-data/", contractAddress: "", chain: "ethereum" });
  assert.equal(meta.checks[0].status, "fail");
  assert.match(meta.checks[0].evidence, /private address/);
});
test("live: dead host fails the site check and yields SKIP", { skip: !LIVE }, async () => {
  const { runVerification } = await import("../lib/verify.mjs");
  const report = await runVerification({ url: "https://this-host-does-not-exist-xyz123.com/", contractAddress: "", chain: "ethereum" });
  assert.equal(report.checks[0].status, "fail");
  assert.equal(report.verdict, "SKIP");
});

test("live: USDT on BSC has contract code and a trading pair", { skip: !LIVE }, async () => {
  const { runVerification } = await import("../lib/verify.mjs");
  const report = await runVerification({
    url: "https://bscscan.com/token/0x55d398326f99059fF775485246999027B3197955",
    contractAddress: "0x55d398326f99059fF775485246999027B3197955",
    chain: "bsc",
  });
  const contract = report.checks.find((c) => c.id === 3);
  const token = report.checks.find((c) => c.id === 4);
  assert.ok(contract.status === "pass" || contract.status === "warn", `contract check: ${contract.status}`);
  assert.equal(token.status, "pass");
});
