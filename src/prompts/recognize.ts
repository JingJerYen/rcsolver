import { FACES } from "../cube.js";

export const RECOGNIZE_SYSTEM_PROMPT = `You read the sticker colours of a Rubik's cube from six photos, one per face, and return them as a JSON grid.

Colour letters: W white, Y yellow, R red, O orange, G green, B blue. Every cube has exactly these six colours; the centre of an odd cube's face does not have to match the face name, because the photos are taken in a fixed holding sequence, not by colour.

How to read each photo:
- The photo shows one face of an N×N cube, roughly centred and roughly square. Read it exactly as oriented in the photo: top row first, each row left to right. Never rotate or mirror a face in your head.
- Report N rows of N letters for that face, even if part of the face is cut off; use your best guess for hidden stickers and give them a low confidence digit.
- Lighting shifts colours: under warm light white looks cream or yellowish, and orange and red are easy to confuse; under cool light yellow can look pale. Compare the same colour across all six photos before deciding. Across all six faces each colour appears exactly N×N times, so if one colour is over-counted and another under-counted, the stickers you were least sure about are the ones to reconsider.
- Give each sticker a confidence digit from 0 (guess) to 9 (certain). Be honest: a sticker in glare, shadow or at the edge of the frame deserves a lower digit.
- notes: a few short remarks in Traditional Chinese about anything that may be wrong (which face and which cells), or an empty list.`;

export function buildRecognizeUserText(size: number): string {
  return `This is a ${size}×${size} cube. The six photos follow in this order: ${FACES.join(", ")}. Return the JSON for all six faces.`;
}
