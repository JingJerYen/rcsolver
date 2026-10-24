import type { Face, FaceImage } from "./api.js";
import type { Gesture } from "./guideCube.js";
import { tr } from "./i18n.js";

/** One step of the guided capture: the whole-cube turns to make, then which face is in front. */
export interface Step {
  face: Face;
  turns: Gesture[];
  /** Quarter turns clockwise that bring this photo to the net's orientation (0 when it already is). */
  quarter?: 1 | -1;
}

/** Turn the whole cube so the right face comes to the front (the "y" cube rotation). */
const LEFT: Gesture = { axis: "y", deg: -90 };
/** Tilt the top toward you so the up face comes to the front (the "x'" cube rotation). */
const DOWN: Gesture = { axis: "x", deg: 90 };
/** Tilt the top away from you (the "x" cube rotation). */
const UP: Gesture = { axis: "x", deg: -90 };

/**
 * Holding sequence. The "up" face never changes hands, so every side photo has U at its top. After
 * the fourth side the cube tilts straight down from L, one gesture instead of turning back to F
 * first, so the U photo has R at its top and the D photo (after tilting up twice) has L at its
 * top. Those two are turned a quarter as they are taken, so every photo is stored the way the net
 * lays it out.
 */
export const STEPS: Step[] = [
  { face: "F", turns: [] },
  { face: "R", turns: [LEFT] },
  { face: "B", turns: [LEFT] },
  { face: "L", turns: [LEFT] },
  { face: "U", turns: [DOWN], quarter: 1 },
  { face: "D", turns: [UP, UP], quarter: -1 },
];

/** All turns made before step `index`: the orientation the physical cube is in when that step starts. */
export function turnsBefore(index: number): Gesture[] {
  return STEPS.slice(0, index).flatMap((s) => s.turns);
}

export const OUTPUT_PX = 512;
export const FRAME_FRACTION = 0.7;

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(tr("這個瀏覽器不支援相機，請改用「從相簿選擇」。", "This browser has no camera access. Use \"Choose from photos\" instead."));
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1280 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  return stream;
}

export function closeCamera(video: HTMLVideoElement) {
  const s = video.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** A 512px square canvas with `src` (the square at sx, sy, side) drawn turned `quarter` quarter turns clockwise. */
function squareCanvas(src: CanvasImageSource, sx: number, sy: number, side: number, quarter = 0): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = OUTPUT_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(OUTPUT_PX / 2, OUTPUT_PX / 2);
  ctx.rotate((quarter * Math.PI) / 2);
  ctx.drawImage(src, sx, sy, side, side, -OUTPUT_PX / 2, -OUTPUT_PX / 2, OUTPUT_PX, OUTPUT_PX);
  return canvas;
}

function toFaceImage(canvas: HTMLCanvasElement): FaceImage {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1), dataUrl };
}

/** Crop the centred square that the on-screen frame covers (object-fit: cover) and scale it to 512px. */
export function captureFromVideo(video: HTMLVideoElement, quarter = 0): FaceImage {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error(tr("相機還沒準備好，再按一次。", "The camera isn't ready yet. Tap again."));
  const side = Math.min(vw, vh) * FRAME_FRACTION;
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  return toFaceImage(squareCanvas(video, sx, sy, side, quarter));
}

/** Centre-crop an uploaded photo to a square (full width, not the 70% frame) and scale it to 512px. */
export async function captureFromFile(file: File, quarter = 0): Promise<FaceImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(tr("讀不到這張圖片。", "Couldn't read this image.")));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    return toFaceImage(squareCanvas(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, quarter));
  } finally {
    URL.revokeObjectURL(url);
  }
}
