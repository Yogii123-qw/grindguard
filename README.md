# GrindGuard

GrindGuard checks a crypto airdrop or testnet program before you spend a day on it. Paste the program URL. GrindGuard runs ten live checks against the site, the chain, and public records, then returns a verdict of GRIND, CAUTION, or SKIP with the evidence behind it.

Every check runs live. Nothing here is simulated.

## What it checks

| # | Check | Source |
|---|-------|--------|
| 1 | Official site reachable | Direct HTTP request to the URL |
| 2 | Team identity | Team page and profile links on the site |
| 3 | Contract exists and source verified | Public EVM RPC (`eth_getCode`) and block explorer source page |
| 4 | Token and TGE status | DexScreener public API |
| 5 | Hidden costs | Cost keywords in the fetched page text |
| 6 | Marketing versus on-chain facts | Site claims compared with on-chain results |
| 7 | Domain age | RDAP registration date, with crt.sh as fallback |
| 8 | Social presence | Declared social links, each requested live |
| 9 | Faucet and participation cost | Participation terms on the fetched page |
| 10 | Payout evidence | GitHub public search and docs links on the site |

## Scoring

Each check carries a weight. Site reachability and contract checks weigh most at 15 points each. Team, token, costs, marketing, domain age, and social weigh 10 each. Faucet and payout weigh 5 each. The total is 100.

A fail on any check means SKIP. An unknown result on the site, contract, or token check means CAUTION. A score below 70 means CAUTION. Everything else is GRIND.

## AI synthesis

When a Groq API key is configured, the server asks Groq `gpt-oss-120b` to write a short summary from the check results only. The model never changes the verdict. Without a key, deterministic checks still run and the page states plainly that no AI synthesis ran.

## Run locally

```sh
node server.mjs
```

Open http://127.0.0.1:3000. To enable AI synthesis, copy `.env.example` to `.env` and set `GROQ_API_KEY`. Never commit a real key.

Run tests:

```sh
npm test
```

Live tests call public endpoints and run only with `RUN_LIVE=1`:

```sh
RUN_LIVE=1 npm test
```

## Deploy

The repo ships with `vercel.json`. `api/verify.js` runs the same verification code as the local server. Deploy with Vercel and set `GROQ_API_KEY` in the project settings when AI synthesis is wanted.

## Honest limits

Sites behind bot protection cannot be read. That check reports unknown instead of guessing. Pages that render content with JavaScript may show fewer links than a browser sees, because GrindGuard reads the static HTML. No code can prove what a team intends to do. A verdict is a starting point for your own check, not a promise. Verdicts stay in the session and are never published.

## License

MIT. See LICENSE.
