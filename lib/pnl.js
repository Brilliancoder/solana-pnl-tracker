/**
 * Roll a wallet's trades up into per-token profit and loss, in SOL.
 *
 * Cash and chart value are kept apart:
 *  - realized    = SOL actually received for tokens whose purchase is in the window, minus what they cost
 *  - open value  = what the unsold tokens are worth now (a chart number, not cash)
 *  - unmatched   = SOL received for tokens that were not bought inside the window (transfers in, or older buys)
 *
 * Pure function. `prices` maps mint -> price in SOL. `solUsd` converts stablecoin trades.
 */
export function computePnl(trades, { prices = new Map(), solUsd = null } = {}) {
  const tokens = new Map();
  const get = (mint) => {
    if (!tokens.has(mint)) tokens.set(mint, { mint, bought: 0, spent: 0, sold: 0, received: 0, transferredIn: 0, transferredOut: 0, buys: 0, sells: 0, first: null, last: null });
    return tokens.get(mint);
  };
  const toSol = (t) => (t.quote === "SOL" ? t.quoteAmount : t.quote === "USD" && solUsd ? t.quoteAmount / solUsd : 0);
  let fees = 0;
  let skipped = 0;

  for (const t of [...trades].sort((a, b) => (a.time || 0) - (b.time || 0))) {
    fees += t.fee || 0;
    if (t.type === "swap") { skipped++; continue; } // token-for-token has no SOL price to book
    const row = get(t.mint);
    row.first = row.first ?? t.time;
    row.last = t.time;
    if (t.type === "buy") { row.bought += t.tokenAmount; row.spent += toSol(t); row.buys++; }
    else if (t.type === "sell") { row.sold += t.tokenAmount; row.received += toSol(t); row.sells++; }
    else if (t.type === "transfer_in") row.transferredIn += t.tokenAmount;
    else if (t.type === "transfer_out") row.transferredOut += t.tokenAmount;
  }

  const rows = [];
  for (const r of tokens.values()) {
    if (!r.buys && !r.sells) continue;
    const matched = Math.min(r.bought, r.sold);
    const cost = r.bought > 0 ? r.spent * (matched / r.bought) : 0;
    const proceeds = r.sold > 0 ? r.received * (matched / r.sold) : 0;
    const open = Math.max(0, r.bought - r.sold);
    const openCost = r.spent - cost;
    const priceSol = prices.get(r.mint) ?? null;
    const openValue = open > 0 ? (priceSol !== null ? open * priceSol : null) : 0;
    rows.push({
      mint: r.mint, buys: r.buys, sells: r.sells, spent: r.spent, received: r.received,
      realized: proceeds - cost,
      roi: cost > 0 ? ((proceeds - cost) / cost) * 100 : null,
      unmatched: r.received - proceeds,
      open, openCost, openValue,
      unrealized: openValue === null ? null : openValue - openCost,
      first: r.first, last: r.last,
    });
  }
  rows.sort((a, b) => b.realized - a.realized);

  const closed = rows.filter((r) => r.sells > 0 && r.buys > 0);
  const sum = (key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
  return {
    rows,
    totals: {
      tokens: rows.length,
      spent: sum("spent"), received: sum("received"),
      realized: sum("realized"), unmatched: sum("unmatched"),
      openCost: sum("openCost"), openValue: sum("openValue"), unrealized: sum("unrealized"),
      unpriced: rows.filter((r) => r.open > 0 && r.openValue === null).length,
      wins: closed.filter((r) => r.realized > 0).length, closed: closed.length,
      winRate: closed.length ? (closed.filter((r) => r.realized > 0).length / closed.length) * 100 : null,
      fees, skippedSwaps: skipped,
    },
  };
}
