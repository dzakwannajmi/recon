/** Base width of the vendored folder at size 1, and how far the open papers spread beyond it (about 1.7 times its width). */
const BASE = 224;
const SPREAD = 1.75;

/** The folder scale that keeps the open papers inside a container of this width. Steps of 0.02 so a resize does not thrash. */
export function folderSize(containerWidth: number): number {
  const raw = containerWidth / (BASE * SPREAD);
  const clamped = Math.min(1.5, Math.max(0.6, raw));
  return Math.floor(clamped * 50) / 50;
}
