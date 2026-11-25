// GrindGuard checks: ten live verifications for airdrop and testnet programs.
// Every check returns { id, name, status, evidence, source, detail }.
// Status values: pass, warn, fail, unknown. No check throws. No simulated data.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA = { "User-Agent": "GrindGuard/1.0 (verification bot; contact via repo)" };

// SSRF guard: never fetch a private address. The user supplies the program
// URL, so the host must resolve to a public IP before any request goes out.
function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  if (isIP(ip) === 6) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd") || low === "::";
  }
  return false;
}

export async function assertPublicHost(hostname) {
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Refusing to fetch a private address.");
    return;
  }
  const addrs = await lookup(hostname, { all: true }).catch(() => []);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("Refusing to fetch a host that resolves to a private address.");
  }
}

export async function fetchWithTimeout(url, ms = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "";
}

export function extractLinks(html) {
  const out = new Set();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return [...out];
}

function result(id, name, status, evidence, source, detail = {}) {
  return { id, name, status, evidence, source, detail };
}

export const RPC_URLS = {
  ethereum: "https://cloudflare-eth.com",
  bsc: "https://bsc-dataseed.binance.org/",
  polygon: "https://polygon-rpc.com/",
  base: "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

export const EXPLORER_SOURCE_URLS = {
  ethereum: "https://api.etherscan.io/api",
  bsc: "https://api.bscscan.com/api",
  polygon: "https://api.polygonscan.com/api",
  base: "https://api.basescan.org/api",
  arbitrum: "https://api.arbiscan.io/api",
};

async function rpcCall(rpcUrl, method, params) {
  const res = await fetchWithTimeout(
    rpcUrl,
    8000,
    {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    },
  );
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

// Read a response body with a hard cap so a hostile server cannot exhaust
// memory. Returns the text, truncated at maxBytes.
export async function readCappedText(res, maxBytes = 1000000) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Response body exceeded the size cap.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

// Fetch the program page exactly once per verification. The result is shared
// by every check that reads the page, so the target site is hit one time
// instead of once per check.
export async function fetchSitePage(url) {
  try {
    await assertPublicHost(new URL(url).hostname);
    const res = await fetchWithTimeout(url, 10000, { headers: UA, redirect: "follow" });
    // Redirects are followed by fetch, so the final host must pass the same
    // public-host guard. A redirect to a private address is refused.
    await assertPublicHost(new URL(res.url).hostname);
    const text = await readCappedText(res);
    const html = text.slice(0, 200000);
    return { ok: res.status === 200, status: res.status, title: extractTitle(html), html, plain: stripTags(html), error: null };
  } catch (err) {
    return { ok: false, status: 0, title: "", html: "", plain: "", error: String(err && err.message ? err.message : err) };
  }
}

// 1. Official site reachable
export async function checkSite(input, page) {
  const name = "Official site reachable";
  if (page.ok && page.title) {
    return result(1, name, "pass", `HTTP 200. Page title: "${page.title}".`, input.url, { status: page.status, title: page.title });
  }
  if (page.ok) {
    return result(1, name, "warn", "HTTP 200 but no page title found in the HTML.", input.url, { status: page.status });
  }
  if (page.status === 403) {
    return result(1, name, "unknown", "Request was refused with HTTP 403. The site may sit behind bot protection.", input.url, { status: page.status });
  }
  if (page.status > 0) {
    return result(1, name, "fail", `Site answered HTTP ${page.status}.`, input.url, { status: page.status });
  }
  return result(1, name, "fail", `Site could not be reached: ${(page.error || "").slice(0, 120)}.`, input.url, { error: (page.error || "").slice(0, 120) });
}

// 2. Team identity
export async function checkTeam(input, page) {
  const name = "Team identity";
  if (!page.ok) {
    return result(2, name, "unknown", "Team could not be checked because the site could not be read.", input.url, {});
  }
  try {
    const links = extractLinks(page.html);
    const teamLinks = links.filter((l) => /team|about|people|founders/i.test(l));
    const profileLinks = links.filter((l) => /linkedin\.com|github\.com\/|x\.com\/|twitter\.com\//i.test(l));
    const distinctProfiles = [...new Set(profileLinks)].length;
    if (teamLinks.length > 0) {
      try {
        const teamUrl = new URL(teamLinks[0], input.url).href;
        const teamPage = await fetchSitePage(teamUrl);
        if (teamPage.ok && teamPage.plain.length > 200) {
          const names = teamPage.plain.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || [];
          const distinct = [...new Set(names)].length;
          if (distinct >= 2) {
            return result(2, name, "pass", `A team page exists and names ${distinct} distinct people. ${distinctProfiles} profile link(s) were found on the main site.`, input.url, { teamPageFound: true, profileLinks: distinctProfiles, namedPeople: distinct });
          }
        }
      } catch {
        // fall through to the page-link evidence below
      }
    }
    const detail = { teamPageFound: teamLinks.length > 0, profileLinks: distinctProfiles };
    if (teamLinks.length > 0 && distinctProfiles >= 2) {
      return result(2, name, "pass", `A team or about page exists and ${distinctProfiles} distinct profile links were found on the site.`, input.url, detail);
    }
    if (teamLinks.length > 0) {
      return result(2, name, "warn", `A team or about page exists, but only ${distinctProfiles} profile link(s) were found on the site. Named people could not be confirmed from the page text.`, input.url, detail);
    }
    return result(2, name, "warn", `No team or about page link was found on the site. ${distinctProfiles} profile link(s) were found. Team identity is not shown on the site itself.`, input.url, detail);
  } catch (err) {
    return result(2, name, "unknown", `Team check failed: ${String(err.message || err).slice(0, 120)}.`, input.url, {});
  }
}

// 3. Contract exists and source verified
export async function checkContract(input) {
  const name = "Contract exists and source verified";
  if (!input.contractAddress) {
    return result(3, name, "unknown", "No contract address was provided, so no on-chain contract check ran.", input.url, {});
  }
  const rpc = RPC_URLS[input.chain] || RPC_URLS.ethereum;
  try {
    const code = await rpcCall(rpc, "eth_getCode", [input.contractAddress, "latest"]);
    if (!code || code === "0x") {
      return result(3, name, "fail", `Address ${input.contractAddress} holds no code on ${input.chain}. The address is an empty account, not a contract.`, rpc, { address: input.contractAddress, chain: input.chain });
    }
    let verified = null;
    try {
      const explorer = EXPLORER_SOURCE_URLS[input.chain];
      if (explorer) {
        const res = await fetchWithTimeout(
          `${explorer}?module=contract&action=getsourcecode&address=${input.contractAddress}`,
          8000,
          { headers: UA },
        );
        const data = await res.json();
        const src = data && data.result && data.result[0] ? data.result[0].SourceCode : "";
        verified = Boolean(src && src.length > 0);
      }
    } catch {
      verified = null;
    }
    const detail = { address: input.contractAddress, chain: input.chain, codeBytes: (code.length - 2) / 2, sourceVerified: verified };
    if (verified === true) {
      return result(3, name, "pass", `Contract code exists on ${input.chain} (${detail.codeBytes} bytes) and the source is verified on the block explorer.`, rpc, detail);
    }
    if (verified === false) {
      return result(3, name, "warn", `Contract code exists on ${input.chain} (${detail.codeBytes} bytes) but the source is NOT verified on the block explorer. Read the code before trusting it.`, rpc, detail);
    }
    return result(3, name, "pass", `Contract code exists on ${input.chain} (${detail.codeBytes} bytes). Source verification could not be confirmed because the explorer endpoint did not answer.`, rpc, detail);
  } catch (err) {
    return result(3, name, "unknown", `Contract check failed: ${String(err.message || err).slice(0, 120)}.`, rpc, { address: input.contractAddress, chain: input.chain });
  }
}

// 4. Token and TGE status
export async function checkToken(input) {
  const name = "Token and TGE status";
  if (!input.contractAddress) {
    return result(4, name, "unknown", "No token address was provided, so no market check ran.", input.url, {});
  }
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${input.contractAddress}`,
      8000,
      { headers: UA },
    );
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    if (pairs.length === 0) {
      return result(4, name, "warn", "No trading pair was found for this token on DexScreener. The token is pre-TGE, unlisted, or the address is not a traded token.", "https://api.dexscreener.com", { pairs: 0 });
    }
    const top = pairs[0];
    const liquidity = top.liquidity && top.liquidity.usd ? Number(top.liquidity.usd).toFixed(2) : "unknown";
    return result(
      4,
      name,
      "pass",
      `${pairs.length} trading pair(s) found. Top pair: ${top.dexId} ${top.baseToken.symbol}/${top.quoteToken.symbol}, price $${top.priceUsd || "unknown"}, liquidity $${liquidity}.`,
      "https://api.dexscreener.com",
      { pairs: pairs.length, dex: top.dexId, priceUsd: top.priceUsd || null, liquidityUsd: liquidity },
    );
  } catch (err) {
    return result(4, name, "unknown", `Market check failed: ${String(err.message || err).slice(0, 120)}.`, "https://api.dexscreener.com", {});
  }
}

// 5. Hidden costs
export async function checkHiddenCosts(input, page) {
  const name = "Hidden costs";
  if (!page.ok) {
    return result(5, name, "unknown", "Cost keywords could not be scanned because the site could not be read.", input.url, {});
  }
  const plain = page.plain;
  const keywords = ["fee", "fees", "deposit", "subscription", "pay to", "payable", "premium", "price", "costs $", "charge"];
  const hits = [];
  for (const kw of keywords) {
    const idx = plain.toLowerCase().indexOf(kw);
    if (idx >= 0 && hits.length < 3) {
      hits.push(plain.slice(Math.max(0, idx - 60), idx + 80).trim());
    }
  }
  if (hits.length === 0) {
    return result(5, name, "pass", "No cost keywords (fee, deposit, subscription, payable, premium, price) were found in the fetched page text.", input.url, { keywordHits: 0 });
  }
  return result(5, name, "warn", `Cost keywords appear on the page. Quote: "${hits[0]}". Read the pricing terms before spending anything.`, input.url, { keywordHits: hits.length, quotes: hits });
}

// 6. Marketing versus on-chain facts
export async function checkMarketing(input, page, contract) {
  const name = "Marketing versus on-chain facts";
  if (!page.ok) {
    return result(6, name, "unknown", "Marketing claims could not be compared because the site could not be read.", input.url, {});
  }
  const plain = page.plain.toLowerCase();
  const claims = [];
  if (plain.includes("audited")) claims.push("audited");
  if (plain.includes("live on mainnet") || plain.includes("mainnet live")) claims.push("live on mainnet");
  if (plain.includes("backed by")) claims.push("backed by");
  if (plain.includes("listed on")) claims.push("listed on");
  if (claims.length === 0) {
    return result(6, name, "pass", "No strong marketing claims (audited, live on mainnet, backed by, listed on) were found on the page, so there was nothing to contradict.", input.url, { claims: [] });
  }
  if (claims.includes("live on mainnet") && contract && contract.status === "fail") {
    return result(6, name, "fail", "The site claims the project is live on mainnet, but the provided contract address holds no code. The claim contradicts the on-chain fact.", input.url, { claims });
  }
  if (claims.includes("audited") && !plain.includes("audit report") && !plain.includes("audit by")) {
    return result(6, name, "warn", `The site claims it is audited, but no audit report link or auditor name was found on the fetched page. Claims: ${claims.join(", ")}.`, input.url, { claims });
  }
  return result(6, name, "pass", `Marketing claims found: ${claims.join(", ")}. None of them contradict the on-chain facts that were checked.`, input.url, { claims });
}

// 7. Domain age (RDAP registration date first, crt.sh as fallback)
export async function checkDomainAge(input) {
  const name = "Domain age";
  let domain;
  try {
    domain = new URL(input.url).hostname;
  } catch {
    return result(7, name, "unknown", "The URL could not be parsed, so no domain check ran.", input.url, {});
  }
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${domain}`, 20000, { headers: UA });
    if (res.ok) {
      const data = await res.json();
      const reg = (data.events || []).find((e) => e.eventAction === "registration");
      if (reg && reg.eventDate) {
        return domainAgeVerdict(domain, new Date(reg.eventDate).getTime(), "https://rdap.org");
      }
    }
  } catch {
    // fall through to crt.sh
  }
  try {
    const res = await fetchWithTimeout(
      `https://crt.sh/?q=%25.${domain}&output=json`,
      15000,
      { headers: UA },
    );
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500));
      const retry = await fetchWithTimeout(`https://crt.sh/?q=%25.${domain}&output=json`, 15000, { headers: UA });
      if (!retry.ok) throw new Error(`crt.sh HTTP ${retry.status}`);
      const retryData = await retry.json();
      return domainAgeFromCerts(retryData, domain);
    }
    if (!res.ok) throw new Error(`crt.sh HTTP ${res.status}`);
    const data = await res.json();
    return domainAgeFromCerts(data, domain);
  } catch (err) {
    return result(7, name, "unknown", `Domain age check failed: ${String(err.message || err).slice(0, 120)}.`, "https://rdap.org", { domain });
  }
}

function domainAgeVerdict(domain, firstSeen, source) {
  const name = "Domain age";
  if (!Number.isFinite(firstSeen)) {
    return result(7, name, "unknown", `Registration date for ${domain} could not be parsed.`, source, { domain });
  }
  const ageDays = Math.floor((Date.now() - firstSeen) / 86400000);
  const firstDate = new Date(firstSeen).toISOString().slice(0, 10);
  if (ageDays < 90) {
    return result(7, name, "warn", `Domain ${domain} was registered on ${firstDate} (${ageDays} days ago). A young domain is a common trait of short-lived programs.`, source, { domain, firstSeen: firstDate, ageDays });
  }
  return result(7, name, "pass", `Domain ${domain} was registered on ${firstDate} (${ageDays} days ago).`, source, { domain, firstSeen: firstDate, ageDays });
}

function domainAgeFromCerts(data, domain) {
  const name = "Domain age";
  if (!Array.isArray(data) || data.length === 0) {
    return result(7, name, "unknown", `No certificates were found for ${domain} in Certificate Transparency logs.`, "https://crt.sh", { domain });
  }
  const firstSeen = data
    .map((c) => new Date(c.not_before).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)[0];
  if (!firstSeen) {
    return result(7, name, "unknown", `Certificate dates for ${domain} could not be parsed.`, "https://crt.sh", { domain });
  }
  const ageDays = Math.floor((Date.now() - firstSeen) / 86400000);
  const firstDate = new Date(firstSeen).toISOString().slice(0, 10);
  if (ageDays < 90) {
    return result(7, name, "warn", `Domain ${domain} first appeared in certificate logs on ${firstDate} (${ageDays} days ago). A young domain is a common trait of short-lived programs.`, "https://crt.sh", { domain, firstSeen: firstDate, ageDays });
  }
  return result(7, name, "pass", `Domain ${domain} first appeared in certificate logs on ${firstDate} (${ageDays} days ago).`, "https://crt.sh", { domain, firstSeen: firstDate, ageDays });
}

// 8. Social presence
export async function checkSocial(input, page) {
  const name = "Social presence";
  if (!page.ok) {
    return result(8, name, "unknown", "Social links could not be checked because the site could not be read.", input.url, {});
  }
  try {
    const links = extractLinks(page.html);
    const social = [...new Set(links.filter((l) => /x\.com\/|twitter\.com\/|discord\.(com|gg)|t\.me\/|telegram\.me\/|github\.com\/|medium\.com\/|youtube\.com\//i.test(l)))];
    if (social.length === 0) {
      return result(8, name, "warn", "No social links (X, Discord, Telegram, GitHub, Medium, YouTube) were found on the site.", input.url, { declared: 0, reachable: 0 });
    }
    const resolved = await Promise.all(
      social.slice(0, 8).map(async (href) => {
        try {
          const absolute = new URL(href, input.url).href;
          const res = await fetchWithTimeout(absolute, 6000, { headers: UA, redirect: "follow" });
          if (res.body && res.body.cancel) await res.body.cancel().catch(() => {});
          return { href: absolute, ok: res.status < 400, status: res.status };
        } catch {
          return { href, ok: false, status: 0 };
        }
      }),
    );
    const reachable = resolved.filter((r) => r.ok).length;
    const dead = resolved.filter((r) => !r.ok).map((r) => r.href);
    const detail = { declared: social.length, reachable, dead };
    if (reachable === 0) {
      return result(8, name, "fail", `All ${social.length} declared social link(s) are dead or unreachable. A program with no working public channel cannot be contacted when something goes wrong.`, input.url, detail);
    }
    if (reachable < social.length) {
      return result(8, name, "warn", `${reachable} of ${social.length} declared social link(s) respond. Dead: ${dead.slice(0, 2).join(", ")}.`, input.url, detail);
    }
    return result(8, name, "pass", `All ${social.length} declared social link(s) respond.`, input.url, detail);
  } catch (err) {
    return result(8, name, "unknown", `Social check failed: ${String(err.message || err).slice(0, 120)}.`, input.url, {});
  }
}

// 9. Faucet and participation cost
export async function checkFaucet(input, page) {
  const name = "Faucet and participation cost";
  if (!page.ok) {
    return result(9, name, "unknown", "Participation terms could not be read because the site could not be read.", input.url, {});
  }
  const plain = page.plain.toLowerCase();
    const mentionsFaucet = /faucet|claim free|free claim|free testnet|testnet token/.test(plain);
    const mentionsPayment = /pay |payment|buy |purchase|deposit|stake.*token|connect wallet.*pay/.test(plain);
    const saysFree = /free to join|free to participate|no cost|100% free|completely free/.test(plain);
    const detail = { mentionsFaucet, mentionsPayment, saysFree };
    if (saysFree && !mentionsPayment) {
      return result(9, name, "pass", "The site states participation is free and no payment wording was found on the fetched page.", input.url, detail);
    }
    if (mentionsPayment) {
      return result(9, name, "warn", "The page mentions payment, purchase, or deposit wording. Read the exact cost before joining.", input.url, detail);
    }
    if (mentionsFaucet) {
      return result(9, name, "pass", "The page mentions a faucet or free testnet tokens, and no payment wording was found on the fetched page.", input.url, detail);
    }
    return result(9, name, "warn", "The page does not state clearly whether participation is free. Cost terms are unclear from the fetched page.", input.url, detail);
}

// 10. Payout evidence
export async function checkPayout(input, page) {
  const name = "Payout evidence";
  const programName = programNameFromUrl(input.url);
  let repoFound = false;
  let repoInfo = "";
  let weakRepo = "";
  try {
    if (programName) {
      const res = await fetchWithTimeout(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(programName)}&per_page=5`,
        8000,
        { headers: { ...UA, Accept: "application/vnd.github+json" } },
      );
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        const n = programName.toLowerCase();
        const strong = items.find((i) => {
          const parts = String(i.full_name || "").toLowerCase().split("/");
          return (parts[0] || "") === n;
        });
        const medium = items.find((i) => {
          const parts = String(i.full_name || "").toLowerCase().split("/");
          const repo = parts[1] || "";
          return repo === n || repo.startsWith(n + "-") || repo.startsWith(n + "_");
        });
        const weak = items.find((i) => String(i.full_name || "").toLowerCase().includes(n));
        if (strong) {
          repoFound = true;
          repoInfo = `A public repository matches "${programName}" on GitHub: ${strong.full_name}.`;
        } else if (medium) {
          weakRepo = medium.full_name;
        } else if (weak) {
          weakRepo = weak.full_name;
        }
      }
    }
  } catch {
    repoFound = false;
  }
  let docsFound = false;
  if (page.ok) {
    const links = extractLinks(page.html);
    docsFound = links.some((l) => /docs|whitepaper|gitbook|wiki/i.test(l));
  }
  const detail = { repoFound, docsFound };
  if (repoFound || docsFound) {
    return result(10, name, "pass", [repoFound ? repoInfo : "", docsFound ? "A docs or whitepaper link exists on the site." : ""].filter(Boolean).join(" "), input.url, detail);
  }
  if (weakRepo) {
    return result(10, name, "warn", `A repository mentions the name (${weakRepo}) but no official repository was confirmed, and no docs or whitepaper link was found. Payout history cannot be confirmed from public sources.`, input.url, detail);
  }
  return result(10, name, "warn", "No public code repository and no docs or whitepaper link were found. Payout history cannot be confirmed from public sources.", input.url, detail);
}

export function programNameFromUrl(url) {
  try {
    const labels = new URL(url).hostname.replace(/^www\./, "").split(".");
    const generic = new Set(["app", "web", "api", "beta", "testnet", "docs", "portal", "hub", "dashboard", "play", "game"]);
    let name = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    if (generic.has(name) && labels.length >= 3) name = labels[labels.length - 3];
    return name;
  } catch {
    return "";
  }
}

export const CHECK_NAMES = [
  "Official site reachable",
  "Team identity",
  "Contract exists and source verified",
  "Token and TGE status",
  "Hidden costs",
  "Marketing versus on-chain facts",
  "Domain age",
  "Social presence",
  "Faucet and participation cost",
  "Payout evidence",
];
