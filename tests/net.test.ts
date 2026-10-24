import { test } from "node:test";
import assert from "node:assert/strict";
import { UNKNOWN, accuracy, blankRecognition, colorCounts, hexOf, isEdited, makeState, setCell, unknownCount } from "../web/src/net.js";

test("net: a blank net has every sticker unfilled, and filling one is not a correction", () => {
  for (let n = 2; n <= 7; n++) {
    const s = makeState(n, blankRecognition(n));
    assert.equal(unknownCount(s.current), 6 * n * n, `${n}×${n}`);
    assert.ok(s.current.U.every((row) => row === UNKNOWN.repeat(n)));
    assert.equal(accuracy(s).lowConfidence, 0, "blank cells are not flagged as unsure");
  }
  const s = makeState(3, blankRecognition(3));
  setCell(s.current.F, 1, 2, "G");
  assert.equal(unknownCount(s.current), 53);
  assert.equal(isEdited(s, "F", 1, 2), false);
  assert.equal(colorCounts(s.current).G, 1, "unfilled cells count as no colour");
  assert.equal(hexOf(UNKNOWN), hexOf("x"), "anything that is not a colour draws grey");
});

test("net: changing a colour the AI read is a correction", () => {
  const r = blankRecognition(2);
  r.faces.F = ["GG", "GG"];
  const s = makeState(2, r);
  setCell(s.current.F, 0, 0, "R");
  assert.equal(isEdited(s, "F", 0, 0), true);
  assert.equal(isEdited(s, "F", 0, 1), false);
});
