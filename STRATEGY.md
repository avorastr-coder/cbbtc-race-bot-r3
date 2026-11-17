# Strategy: cbBTC 1-minute dip-buy

## Idea

cbBTC on 1-minute bars mean-reverts at the one-hour scale: a sharp hourly
dip is usually followed by a bounce large enough to cover the ~26-40 bps a
full-size round trip costs in fees, slippage and pool impact. Momentum and
EMA-crossover rules do the opposite on this data: they buy after the move
has already happened and get whipsawed by 1-minute noise.

## Rules

- **Entry:** trailing 60-minute return at or below -100 bps. Full cash,
  one position at most.
- **Exit (whole position):** take profit +120 bps over cost, trailing stop
  100 bps below the peak close since entry, hard stop 150 bps below the
  entry close, or 240 bars max hold.
- **Guardrail:** if no buy has ever filled by bar 1425, buy 25% of cash.
  Guarantees the >= 1 trade guardrail on a quiet day; small on purpose.
- A buy the market refuses is retried while its signal holds; a sell the
  market refuses is retried while its exit holds.

## Why these numbers

Swept on the frozen dev window (2026-11-16 06:03 UTC to 2026-11-17
06:03 UTC, BTC $64,461 to $64,776, choppy early, +200 bps rally mid-day,
-106 bps selloff late). The dip rule is a plateau, not a spike:

| dip thr | TP 100 | TP 110 | TP 120 | TP 130 |
|--------:|-------:|-------:|-------:|-------:|
| -80 bps | +$13.85 | +$17.75 | +$18.78 | +$19.93 |
| -90 bps | +$13.96 | +$16.10 | +$18.89 | +$20.04 |
| -100 bps | +$17.83 | +$20.64 | +$24.83 | +$25.86 |
| -110 bps | +$19.66 | +$22.48 | +$22.48 | +$27.71 |

Chosen: dip -100 bps, TP +120 bps (centre of the plateau), max hold 240
bars. The plateau table above was swept with max hold off; with the 240-bar
cap the graded result is **net PnL +$26.80, 6 trades, max drawdown 0.72%**
(see the local grade below). Stop and
trailing stop never triggered on the dev window; they are safety nets for
the race window, not fitted to it. Dip window 60 beats 30 (-$2.00), 90
(+$18.84) and 120 (+$11.66). Entry-confirmation filters (10m bounce,
uptick) did not help and were left out.

Baselines on the same dev window, for comparison: buy-and-hold +$1.07,
momentum +$2.45, ema-cross -$106.21, adx-momentum -$32.66,
rsi-bollinger -$24.25, hold-cash $0.00.

## Risks

- One window is one sample. The race window is unseen; a day with no
  -100 bps hourly dip trades only the guardrail, and a dip that keeps
  falling hits the -150 bps stop.
- Max drawdown on dev is small (0.72%) because positions are short-lived
  and the stop caps the loss per trade at ~150 bps plus costs.
- Deterministic: integer arithmetic only, no randomness, no clock.
