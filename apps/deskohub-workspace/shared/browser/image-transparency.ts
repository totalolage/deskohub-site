/**
 * Whether any pixel of RGBA image data (`ImageData.data`) is less than fully
 * opaque.
 */
export const isTransparent = (pixels: Uint8ClampedArray) => {
  for (let alpha = 3; alpha < pixels.length; alpha += 4) {
    if (pixels[alpha] !== 255) return true;
  }
  return false;
};
