/**
 * Whether the file is an animated PNG (APNG) or an AVIF image sequence.
 * ImageMagick's WebAssembly build reads only the first frame of both, so it
 * can't count their frames the way it does a GIF's or a WebP's. Reads only
 * the container structure; other formats, and bytes it can't make sense of,
 * count as still.
 */
export const isAnimatedPngOrAvif = (bytes: Uint8Array): boolean => {
  if (startsWith(bytes, 0, "\x89PNG\r\n\x1a\n")) return isAnimatedPng(bytes);
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

/** An animated AVIF is an image sequence, branded `avis`. */
const isAvifSequence = (bytes: Uint8Array) => {
  const boxEnd = Math.min(readUint32(bytes, 0), bytes.length);
  for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
    // Bytes 12–15 are the minor version, not a brand.
    if (offset !== 12 && startsWith(bytes, offset, "avis")) return true;
  }
  return false;
};
