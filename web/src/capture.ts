import type { Face, FaceImage } from "./api.js";

/** One step of the guided capture: which face lands in front after the gesture. */
export interface Step {
  face: Face;
  title: string;
  gesture: string;
  arrow: "none" | "left" | "down" | "up2";
}

/**
 * Holding sequence. The "up" face never changes hands, so every side photo has U at its top;
 * the U photo (after tilting down from face 1) has B at its top and the D photo (after tilting up
 * twice) has F at its top. That is exactly the standard net layout, so no image rotation is needed.
 */
export const STEPS: Step[] = [
  { face: "F", title: "第 1 面：前", gesture: "拿好方塊，任一面正對你。記住哪一面在上面，之後都不要換。對準框，拍照。", arrow: "none" },
  { face: "R", title: "第 2 面：右", gesture: "整顆向左轉 90°：原本在右邊的那一面轉到正對你，上面不動。", arrow: "left" },
  { face: "B", title: "第 3 面：後", gesture: "再整顆向左轉 90°，上面不動。", arrow: "left" },
  { face: "L", title: "第 4 面：左", gesture: "再整顆向左轉 90°，上面不動。", arrow: "left" },
  { face: "U", title: "第 5 面：上", gesture: "先向左轉一次回到第 1 面，再整顆向下翻 90°，讓上面正對你。", arrow: "down" },
  { face: "D", title: "第 6 面：底", gesture: "整顆向上翻兩次（180°），讓底面正對你。", arrow: "up2" },
];

export const OUTPUT_PX = 512;
export const FRAME_FRACTION = 0.7;

const ARROWS: Record<Step["arrow"], string> = {
  none: `<rect x="30" y="30" width="60" height="60" rx="8" fill="none" stroke="#195ed6" stroke-width="5" stroke-dasharray="8 6"/>`,
  left: `<rect x="35" y="35" width="50" height="50" rx="8" fill="#e9f0ff" stroke="#195ed6" stroke-width="4"/>
    <path d="M95 25 A45 45 0 0 0 25 25" fill="none" stroke="#195ed6" stroke-width="6" stroke-linecap="round"/>
    <path d="M18 14 L24 32 L40 22 Z" fill="#195ed6"/>`,
  down: `<rect x="35" y="35" width="50" height="50" rx="8" fill="#e9f0ff" stroke="#195ed6" stroke-width="4"/>
    <path d="M100 20 A48 48 0 0 1 100 100" fill="none" stroke="#195ed6" stroke-width="6" stroke-linecap="round"/>
    <path d="M110 104 L92 98 L104 86 Z" fill="#195ed6"/>`,
  up2: `<rect x="35" y="35" width="50" height="50" rx="8" fill="#e9f0ff" stroke="#195ed6" stroke-width="4"/>
    <path d="M100 100 A48 48 0 0 0 100 20" fill="none" stroke="#195ed6" stroke-width="6" stroke-linecap="round"/>
    <path d="M110 16 L92 22 L104 34 Z" fill="#195ed6"/>
    <text x="60" y="68" text-anchor="middle" font-size="22" font-weight="700" fill="#195ed6">×2</text>`,
};

export function arrowSvg(kind: Step["arrow"]): string {
  return ARROWS[kind];
}

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
