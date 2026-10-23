import type { Face, FaceImage } from "./api.js";
import type { Gesture } from "./guideCube.js";

/** One step of the guided capture: the whole-cube turns to make, then which face is in front. */
export interface Step {
  face: Face;
  title: string;
  gesture: string;
  turns: Gesture[];
}

/** Turn the whole cube so the right face comes to the front (the "y" cube rotation). */
const LEFT: Gesture = { axis: "y", deg: -90 };
/** Tilt the top toward you so the up face comes to the front (the "x'" cube rotation). */
const DOWN: Gesture = { axis: "x", deg: 90 };
/** Tilt the top away from you (the "x" cube rotation). */
const UP: Gesture = { axis: "x", deg: -90 };

/**
 * Holding sequence. The "up" face never changes hands, so every side photo has U at its top;
 * the U photo (after tilting down from face 1) has B at its top and the D photo (after tilting up
 * twice) has F at its top. That is exactly the standard net layout, so no image rotation is needed.
 */
export const STEPS: Step[] = [
  { face: "F", title: "第 1 面", gesture: "任一面正對你，像小方塊這樣拿。標「上」的那面整個過程都要保持在上面。對準框，拍照。", turns: [] },
  { face: "R", title: "第 2 面", gesture: "照小方塊的示範，整顆轉一下：剛拍的那面轉到左邊，右邊那面轉到正對你。上面不動。", turns: [LEFT] },
  { face: "B", title: "第 3 面", gesture: "再照示範轉一次，同一個方向，上面不動。", turns: [LEFT] },
  { face: "L", title: "第 4 面", gesture: "再轉一次，同一個方向，上面不動。", turns: [LEFT] },
  { face: "U", title: "第 5 面", gesture: "照示範：先再轉一次回到第 1 面，然後整顆往你的方向翻下來，讓「上」那面正對你。", turns: [LEFT, DOWN] },
  { face: "D", title: "第 6 面", gesture: "照示範：整顆往遠離你的方向翻過去兩次，讓原本的底面正對你。", turns: [UP, UP] },
];

/** All turns made before step `index`: the orientation the physical cube is in when that step starts. */
export function turnsBefore(index: number): Gesture[] {
  return STEPS.slice(0, index).flatMap((s) => s.turns);
}

export const OUTPUT_PX = 512;
export const FRAME_FRACTION = 0.7;

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("這個瀏覽器不支援相機，請改用「從相簿選擇」。");
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

function toFaceImage(canvas: HTMLCanvasElement): FaceImage {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1), dataUrl };
}

/** Crop the centred square that the on-screen frame covers (object-fit: cover) and scale it to 512px. */
export function captureFromVideo(video: HTMLVideoElement): FaceImage {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error("相機還沒準備好，再按一次。");
  const side = Math.min(vw, vh) * FRAME_FRACTION;
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = OUTPUT_PX;
  canvas.getContext("2d")!.drawImage(video, sx, sy, side, side, 0, 0, OUTPUT_PX, OUTPUT_PX);
  return toFaceImage(canvas);
}

/** Centre-crop an uploaded photo to a square (full width, not the 70% frame) and scale it to 512px. */
export async function captureFromFile(file: File): Promise<FaceImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("讀不到這張圖片。"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUTPUT_PX;
    canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, OUTPUT_PX, OUTPUT_PX);
    return toFaceImage(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
