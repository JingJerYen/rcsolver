import { test } from "node:test";
import assert from "node:assert/strict";
import { averageOf5, clock } from "../web/src/speedView.js";

test("the clock reads minutes, seconds and hundredths", () => {
  assert.equal(clock(0), "0:00.00");
  assert.equal(clock(8421), "0:08.42");
  assert.equal(clock(75999), "1:15.99");
});

test("the average of five leaves out the best and the worst of the latest five", () => {
  const solves = (ms: number[]) => ms.map((m) => ({ ms: m, moves: 0, ts: 0 }));
  assert.equal(averageOf5(solves([1000, 2000, 3000, 4000])), null);
  assert.equal(averageOf5(solves([10000, 20000, 30000, 40000, 90000, 1])), 30000);
});
