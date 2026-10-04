import { test } from "node:test";
import assert from "node:assert/strict";
import { fareValue, formatMoney, makeChange, pay, walletValue } from "../scripts/fare.mjs";

const wallet = (pp = 0, gp = 0, ep = 0, sp = 0, cp = 0) => ({ pp, gp, ep, sp, cp });

test("fare settings in copper", () => {
  assert.equal(fareValue({ amount: 2, coin: "sp" }), 20);
  assert.equal(fareValue({ amount: 1, coin: "gp" }), 100);
  assert.equal(fareValue({ amount: 0, coin: "gp" }), 0);
  assert.equal(fareValue(undefined), 0);
});

test("wallet value and money text", () => {
  assert.equal(walletValue(wallet(1, 2, 1, 3, 4)), 1000 + 200 + 50 + 30 + 4);
  assert.equal(formatMoney(150), "1 gp 5 sp");
  assert.equal(formatMoney(0), "free");
});

test("exact coins pay exactly", () => {
  const r = pay(wallet(0, 0, 0, 5, 0), 20);
  assert.deepEqual(r.paid, wallet(0, 0, 0, 2, 0));
  assert.deepEqual(r.after, wallet(0, 0, 0, 3, 0));
});

test("a gold piece gets change back", () => {
  const r = pay(wallet(0, 1), 20);
  assert.deepEqual(r.paid, wallet(0, 1));
  assert.deepEqual(r.change, wallet(0, 0, 1, 3, 0));
  assert.equal(walletValue(r.after), 80);
});

test("short of the fare", () => {
  assert.equal(pay(wallet(0, 0, 0, 1, 5), 20), null);
});

test("value is conserved", () => {
  for (const w of [wallet(1, 1, 1, 1, 1), wallet(0, 0, 3, 0, 0), wallet(0, 0, 0, 0, 40), wallet(2)]) {
    const r = pay(w, 35);
    assert.equal(walletValue(r.after), walletValue(w) - 35);
    for (const v of Object.values(r.after)) assert.ok(v >= 0);
  }
});

test("change is the fewest coins", () => {
  assert.deepEqual(makeChange(1166), wallet(1, 1, 1, 1, 6));
});
