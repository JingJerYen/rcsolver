// Records docs/demo.gif: run the mock server (MOCK_MODE=1 PORT=3123 node dist/server.js), then
// FRAMES=/tmp/frames node scripts/record-demo.mjs (needs playwright) and encode with ffmpeg:
// ffmpeg -framerate 8 -i /tmp/frames/f%04d.png -vf "scale=300:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" docs/demo.gif
import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.FRAMES;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
// A fake camera: a canvas stream showing the cube face for the current step, drawn by the test.
await page.addInitScript(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 480; canvas.height = 480;
  const g = canvas.getContext("2d");
  const HEX = { W: "#f4f4f4", Y: "#f7d117", R: "#e03131", O: "#ff8c1a", G: "#17b36b", B: "#1f6fe0" };
  window.__drawFace = (rows) => {
    g.fillStyle = "#3b3b3b"; g.fillRect(0, 0, 480, 480);
    g.fillStyle = "#101418"; g.fillRect(96, 96, 288, 288);
    rows.forEach((row, r) => [...row].forEach((c, i) => { g.fillStyle = HEX[c]; g.beginPath(); g.roundRect(104 + i * 94, 104 + r * 94, 84, 84, 10); g.fill(); }));
  };
  window.__drawFace(["WWW", "WWW", "WWW"]);
  setInterval(() => { /* keep the stream live */ g.fillRect(0, 0, 1, 1); }, 200);
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15);
});
let n = 0;
const FPS = 8;
let recording = false;
const rec = async (ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const t = Date.now();
    await page.screenshot({ path: `${OUT}/f${String(n++).padStart(4, "0")}.png` });
    const left = 1000 / FPS - (Date.now() - t);
    if (left > 0) await page.waitForTimeout(left);
  }
};
await page.goto("http://localhost:3123/");
await page.waitForFunction(() => window.rcsolverTest);
await page.evaluate(() => document.getElementById("mock").style.display = "none");
await rec(1600);
const scr = await page.evaluate(() => window.rcsolverTest.scramble(3, 77));
const faces = scr.recognition.faces;
await page.click("#start");
await page.waitForFunction(() => document.getElementById("video").videoWidth > 0, null, { timeout: 10000 });
await page.evaluate(() => document.getElementById("mock").style.display = "none");
const order = ["F", "R", "B", "L", "U", "D"];
for (let i = 0; i < 6; i++) {
  await page.evaluate((rows) => window.__drawFace(rows), faces[order[i]]);
  await rec(i === 0 ? 1500 : 1100);
  await page.click("#shoot");
}
await page.waitForSelector("#review:not(.hidden)");
await rec(900);
await page.click("#send");
await page.waitForSelector("#result:not(.hidden)", { timeout: 20000 });
// the mock backend answers with random colours (not a real cube): show the scramble we photographed instead
await page.evaluate((scr) => window.rcsolverTest.showNet(scr.size, scr.recognition), scr);
await page.evaluate(() => document.getElementById("mock").style.display = "none");
await rec(1800);
await page.click("#solve");
await page.waitForSelector("#solveView:not(.hidden)", { timeout: 60000 });
await page.evaluate(() => document.getElementById("mock").style.display = "none");
await page.evaluate(() => window.rcsolverTest.setSpeed(700, 500));
await rec(600);
await page.click("#play");
await rec(5400);
await browser.close();
console.log("frames", n);
