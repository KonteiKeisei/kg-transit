// Fares in dnd5e coins. Pure apart from reading the dollar rate setting (with a default).
// Values in copper: pp 1000, gp 100, ep 50, sp 10, cp 1 (the standard dnd5e rates). Money is paid
// in coins (the sheets keep coins) but always SHOWN in the period's dollars, at the world's
// copper per dollar (1000 by default: $1 is a platinum piece).

export const COINS = [
  { key: "pp", value: 1000, label: "pp" },
  { key: "gp", value: 100, label: "gp" },
  { key: "ep", value: 50, label: "ep" },
  { key: "sp", value: 10, label: "sp" },
  { key: "cp", value: 1, label: "cp" }
];

const VALUE = Object.fromEntries(COINS.map((c) => [c.key, c.value]));

/** A fare setting ({ amount, coin }) in copper. */
export function fareValue(fare) {
  return Math.max(0, Math.round((Number(fare?.amount) || 0) * (VALUE[fare?.coin] ?? 10)));
}

export function walletValue(currency = {}) {
  return COINS.reduce((sum, coin) => sum + Math.max(0, Math.floor(Number(currency[coin.key]) || 0)) * coin.value, 0);
}

/** Copper per period dollar: the world's setting, else 1000. */
export function dollarRate() {
  try { return Number(globalThis.game?.settings?.get?.("kg-transit", "dollarRate")) || 1000; } catch { return 1000; }
}

/** An amount in copper as dollars: "$4.98". `free` (a fare of nothing) says "free" instead of "$0.00". */
export function formatMoney(copper, { rate = dollarRate(), free = false } = {}) {
  if (!copper && free) return "free";
  const dollars = Math.max(0, copper) / rate;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Fewest coins making `copper` exactly (these denominations are canonical, so greedy is optimal). */
export function makeChange(copper) {
  const coins = {};
  let left = copper;
  for (const coin of COINS) {
    coins[coin.key] = Math.floor(left / coin.value);
    left -= coins[coin.key] * coin.value;
  }
  return coins;
}

/**
 * Pay `price` (copper) from a wallet. Pays exactly if the coins allow it, otherwise overpays
 * by as little as possible and takes change. Among equal amounts, uses the fewest coins.
 * Returns { paid, change, after } as coin counts, or null when the wallet is short.
 */
export function pay(currency, price) {
  const have = Object.fromEntries(COINS.map((c) => [c.key, Math.max(0, Math.floor(Number(currency?.[c.key]) || 0))]));
  if (price <= 0) return { paid: makeChange(0), change: makeChange(0), after: have };
  if (walletValue(have) < price) return null;

  // Bounded knapsack over amounts up to price + (largest coin - 1): overpaying by a whole
  // largest coin or more is never needed.
  const limit = price + COINS[0].value - 1;
  let best = new Array(limit + 1).fill(null);
  best[0] = { count: 0, used: makeChange(0) };
  for (const coin of COINS) {
    const next = best.slice();
    const most = Math.min(have[coin.key], Math.ceil(limit / coin.value));
    for (let amount = 0; amount <= limit; amount++) {
      if (!best[amount]) continue;
      for (let n = 1; n <= most; n++) {
        const total = amount + n * coin.value;
        if (total > limit) break;
        const count = best[amount].count + n;
        if (!next[total] || count < next[total].count) next[total] = { count, used: { ...best[amount].used, [coin.key]: n } };
      }
    }
    best = next;
  }
  // Adding coins smallest first until the price is met overshoots by less than the largest
  // coin, so some amount in [price, limit] is always reachable.
  let amount = price;
  while (!best[amount]) amount++;
  const paid = best[amount].used;
  const change = makeChange(amount - price);
  const after = Object.fromEntries(COINS.map((c) => [c.key, have[c.key] - paid[c.key] + change[c.key]]));
  return { paid, change, after };
}
