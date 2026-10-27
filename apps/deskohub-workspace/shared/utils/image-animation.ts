/**
 * Whether the image file holds more than one frame: an animated GIF, PNG
 * (APNG), WebP or AVIF. Reads only the container structure, so it's cheap
 * and doesn't decode a pixel. Formats without animation, and bytes it can't
 * make sense of, count as still.
 */
export const isAnimatedImage = (bytes: Uint8Array): boolean => {
  if (startsWith(bytes, 0, "GIF8")) return gifFrameCount(bytes) > 1;
  if (startsWith(bytes, 0, "\x89PNG\r\n\x1a\n")) return isAnimatedPng(bytes);
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) {
    return isAnimatedWebp(bytes);
  }
  if (startsWith(bytes, 4, "ftyp")) return isAvifSequence(bytes);
  return false;
};

const startsWith = (bytes: Uint8Array, offset: number, text: string) =>
  bytes.length >= offset + text.length &&
  [...text].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0)
  );

const readUint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);

/** Counts image descriptors up to the trailer, stopping early at two. */
const gifFrameCount = (bytes: Uint8Array) => {
  const packed = bytes[10] ?? 0;
  let offset = 13 + colorTableBytes(packed);
  let frames = 0;
  while (offset < bytes.length && frames < 2) {
    const introducer = bytes[offset];
    if (introducer === 0x2c) {
      frames += 1;
      offset = skipSubBlocks(
        bytes,
        offset + 10 + colorTableBytes(bytes[offset + 9] ?? 0) + 1
      );
    } else if (introducer === 0x21) {
      offset = skipSubBlocks(bytes, offset + 2);
    } else {
      break;
    }
  }
  return frames;
};

const colorTableBytes = (packed: number) =>
  packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;

const skipSubBlocks = (bytes: Uint8Array, start: number) => {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset] ?? 0;
    offset += 1 + size;
    if (size === 0) break;
  }
  return offset;
};

/** An APNG declares its frames in an `acTL` chunk ahead of the image data. */
const isAnimatedPng = (bytes: Uint8Array) => {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    if (startsWith(bytes, offset + 4, "IDAT")) return false;
    // The chunk's first field is its frame count.
    if (startsWith(bytes, offset + 4, "acTL")) {
      return readUint32(bytes, offset + 8) > 1;
    }
    offset += 12 + length;
  }
  return false;
};

/** An animated WebP sets the animation flag of its extended header. */
const isAnimatedWebp = (bytes: Uint8Array) =>
  startsWith(bytes, 12, "VP8X") && ((bytes[20] ?? 0) & 0x02) !== 0;

/** An animated AVIF is an image sequence, branded `avis`. */
const isAvifSequence = (bytes: Uint8Array) => {
  const boxEnd = Math.min(readUint32(bytes, 0), bytes.length);
  for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
    // Bytes 12–15 are the minor version, not a brand.
    if (offset !== 12 && startsWith(bytes, offset, "avis")) return true;
  }
  return false;
};
