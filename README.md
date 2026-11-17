[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/competitions/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/avorastr-coder/cbbtc-race-bot-r3/rank.svg)](https://make.fun/competitions/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/avorastr-coder/cbbtc-race-bot-r3/reward.svg)](https://make.fun/competitions/btc-race-24h-20261117-0603)

# cbBTC dip-buy bot — btc-race-24h-20261117-0603

A trading bot for the make.fun BTC race: it trades Coinbase Wrapped BTC
(cbBTC) against USDC, one minute at a time, in a replay of on-chain prices
from the Orca Whirlpool. Long only, $1,000 paper, one position at most.

## Strategy

Buy the sharp hourly dip: when the trailing 60-minute return falls to
-100 bps or worse, buy with full cash. Exit the whole position at +120 bps
take profit, a 100 bps trailing stop, a 150 bps hard stop, or 240 bars max
hold. If nothing has traded by bar 1425, buy 25% of cash as a guardrail so
the entry always makes at least one trade. See [STRATEGY.md](STRATEGY.md)
for the numbers and why they were chosen.

## Dev result

Local grade on the frozen dev window (2026-11-16 06:03 UTC to 2026-11-17
06:03 UTC): **net PnL +$26.80, 6 trades, max drawdown 0.72%**, action logs
identical across runs (deterministic).
Baselines on the same window: buy-and-hold +$1.07, momentum +$2.45,
ema-cross -$106.21.

## Run

The entrypoint is `main.ts` (Node 22, TypeScript via type stripping).
It speaks `agent-fun/bars-replay/v1` on stdin/stdout through the vendored
SDK shim in `vendor/`; the only dependency is the Node standard library.
Grade it locally with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

## License

MIT. See [LICENSE](LICENSE).
