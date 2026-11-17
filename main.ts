// cbBTC 1-minute dip-buy bot for agent-fun/bars-replay/v1.
//
// Long only, one position, $1,000 paper. The bot reads one JSON batch per
// minute (a 1-minute bar of cbBTC/USDC from the Orca Whirlpool) and answers
// with buy/sell orders that fill at the next bar's open.
//
// Strategy (tuned on the frozen 24h dev window, 2026-11-16 06:03 UTC to
// 2026-11-17 06:03 UTC; see STRATEGY.md):
//   - Entry: the trailing 60-minute return falls to -100 bps or worse.
//     A sharp one-hour dip in cbBTC mean-reverts often enough that buying
//     it beats chasing momentum, which whipsaws on 1-minute bars: on the
//     dev window every momentum/EMA baseline lost money or barely broke
//     even, while this rule made money on every neighbouring parameter
//     choice, not just one lucky setting.
//   - Exit, whole position: take profit at +120 bps over cost, a trailing
//     stop 100 bps below the peak close since entry, a hard stop 150 bps
//     below the entry close, or 240 bars max hold. A round trip costs
//     about 26-40 bps in fees, slippage and pool impact, so the 120 bps
//     target leaves a real margin after costs.
//
// Local grade on the dev window (grade-local --driver process, run twice):
// net PnL +$26.80, 6 trades, max drawdown 0.72%, action logs identical
// across runs. Baselines on the same window: buy-and-hold +$1.07,
// momentum +$2.45, ema-cross -$106.21.
//   - Last-chance guardrail: if no buy has ever filled by bar 1425, buy
//     25% of equity. This only guarantees the >= 1 trade guardrail on a
//     quiet day; the stake is small on purpose.
//   - One open position at most, full cash per buy, never more than the
//     caps allow. A buy the market refuses (slippage, no bar) is retried
//     while its signal still holds; a sell the market refuses is retried
//     while its exit still holds.
//
// Determinism: pure integer arithmetic on the bars seen so far. No network,
// no wall clock, no files, no randomness, no environment reads. The same
// bars give the same orders on every execution.

import { runBars, type Bar, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Trailing return window, in bars. */
const DIP_WINDOW = 60;
/** Entry when the trailing return is at or below this, in tenths of a bp. */
const DIP_THRESHOLD_TENTHS = -1000n;
/** Take profit over cost, in bps. */
const TAKE_PROFIT_BPS = 120n;
/** Trailing stop below the peak close since entry, in bps. */
const TRAIL_BPS = 100n;
/** Hard stop below the entry close, in bps. */
const STOP_BPS = 150n;
/** Max bars to hold one position. */
const MAX_HOLD_BARS = 240;
/** Bars in the window; the last batch (seq warmupBars + 1439) cannot trade. */
const WINDOW_BARS = 1440;
/** Guardrail bar (relative to the scored window's first batch). */
const GUARDRAIL_BAR = 1425;
/** Guardrail stake: one quarter of cash. */
const GUARDRAIL_NUM = 1n;
const GUARDRAIL_DEN = 4n;
const MAX_SLIPPAGE_BPS = 100;

const closes: bigint[] = [];
let entryClose: bigint | null = null;
let peakClose: bigint | null = null;
let holdBars = 0;
let traded = false;
let pendingBuy = false;

/** Trailing DIP_WINDOW-bar return in tenths of a bp, or null without history. */
function dipTenths(): bigint | null {
  if (closes.length <= DIP_WINDOW) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - DIP_WINDOW]!;
  return ((now - then) * 100_000n) / then;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): (BuyInput | SellInput)[] {
    // A fill that landed marks the entry as traded, whatever the signal
    // that sent it; a rejected buy frees us to try again.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy' && fill.status === 'filled') {
        traded = true;
        pendingBuy = false;
      } else if (fill.side === 'buy' && fill.status === 'rejected') {
        pendingBuy = false;
        entryClose = null;
      } else if (fill.side === 'sell' && fill.status === 'filled') {
        entryClose = null;
        peakClose = null;
        holdBars = 0;
      }
    }
    let bar: Bar | undefined;
    for (const candidate of batch.bars) {
      if (candidate.symbol === SYMBOL) {
        bar = candidate;
        break;
      }
    }
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes.push(close);
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      holdBars += 1;
      if (peakClose === null || close > peakClose) peakClose = close;
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      let done = false;
      if (value * 10_000n >= cost * (10_000n + TAKE_PROFIT_BPS)) done = true;
      else if (peakClose !== null && close * 10_000n <= peakClose * (10_000n - TRAIL_BPS)) done = true;
      else if (entryClose !== null && close * 10_000n <= entryClose * (10_000n - STOP_BPS)) done = true;
      else if (holdBars >= MAX_HOLD_BARS) done = true;
      if (done) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }
    // Flat: no position, so entry/peak/hold reset unless a buy is in flight.
    if (!pendingBuy) {
      entryClose = null;
      peakClose = null;
      holdBars = 0;
    }
    // No order can fill on the last batch; deciding one there is rejected.
    if (state.seq >= state.warmupBars + WINDOW_BARS - 1) return [];
    if (pendingBuy) return [];
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    // Last-chance guardrail trade, 25% of cash, only before any fill.
    if (!traded && state.seq >= state.warmupBars + GUARDRAIL_BAR) {
      const stake = (state.cash * GUARDRAIL_NUM) / GUARDRAIL_DEN;
      if (stake >= minNotional) {
        entryClose = close;
        pendingBuy = true;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }
    // Main entry: a sharp 60-minute dip.
    const dip = dipTenths();
    if (dip === null || dip > DIP_THRESHOLD_TENTHS) return [];
    const stake = state.cash;
    if (stake < minNotional) return [];
    entryClose = close;
    peakClose = close;
    pendingBuy = true;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
