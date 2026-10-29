/**
 * How many frames the image file holds: more than one for an animated GIF,
 * PNG (APNG), WebP or AVIF, and one for any other picture. Reads only the
 * container structure, so it's cheap and doesn't decode a pixel. An AVIF
 * sequence whose sample table it can't find counts as two frames, the fewest
 * an animation has. Bytes it can't make sense of count as one frame.
 */
export const imageFrameCount = (bytes: Uint8Array): number => {
  if (startsWith(bytes, 0, "GIF8")) return Math.max(1, gifFrameCount(bytes));
  if (startsWith(bytes, 0, "\x89PNG\r\n\x1a\n")) return pngFrameCount(bytes);
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) {
    return webpFrameCount(bytes);
  }
  if (startsWith(bytes, 4, "ftyp") && isAvifSequence(bytes)) {
    return avifSequenceFrameCount(bytes, 0, bytes.length) || 2;
  }
  return 1;
};

const startsWith = (bytes: Uint8Array, offset: number, text: string) =>
  bytes.length >= offset + text.length &&
  [...text].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0)
  );

const readUint32 = (bytes: Uint8Array, offset: number, littleEndian = false) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian
  );

/** Counts the image descriptors up to the trailer. */
const gifFrameCount = (bytes: Uint8Array) => {
  let offset = 13 + colorTableBytes(bytes[10] ?? 0);
  let frames = 0;
  while (offset < bytes.length) {
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
const pngFrameCount = (bytes: Uint8Array) => {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    if (startsWith(bytes, offset + 4, "IDAT")) return 1;
    // The chunk's first field is its frame count.
    if (startsWith(bytes, offset + 4, "acTL")) {
      return Math.max(1, readUint32(bytes, offset + 8));
    }
    offset += 12 + readUint32(bytes, offset);
  }
  return 1;
};

/**
 * An animated WebP sets the animation flag of its extended header and holds
 * one `ANMF` chunk per frame.
 */
const webpFrameCount = (bytes: Uint8Array) => {
  if (!startsWith(bytes, 12, "VP8X") || ((bytes[20] ?? 0) & 0x02) === 0) {
    return 1;
  }
  let frames = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    if (startsWith(bytes, offset, "ANMF")) frames += 1;
    const size = readUint32(bytes, offset + 4, true);
    // Chunks are padded to an even length.
    offset += 8 + size + (size % 2);
  }
  return Math.max(1, frames);
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

/** The boxes that lead from the file down to a track's sample table. */
const sampleTableContainers: ReadonlySet<string> = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
]);

/**
 * A box's size: as declared, from its 64-bit size field when it declares 1,
 * or up to `end` when it declares 0.
 */
const boxSize = (
  bytes: Uint8Array,
  offset: number,
  end: number,
  declared: number
) => {
  if (declared === 0) return end - offset;
  if (declared === 1) {
    return (
      readUint32(bytes, offset + 8) * 2 ** 32 + readUint32(bytes, offset + 12)
    );
  }
  return declared;
};

/**
 * The most samples any track of the sequence lists in its `stsz` box, each
 * sample a frame; 0 when no track lists them.
 */
const avifSequenceFrameCount = (
  bytes: Uint8Array,
  start: number,
  end: number
): number => {
  let frames = 0;
  let offset = start;
  while (offset + 8 <= end) {
    const declared = readUint32(bytes, offset);
    const headerSize = declared === 1 ? 16 : 8;
    if (offset + headerSize > end) break;
    const size = boxSize(bytes, offset, end, declared);
    if (size < headerSize) break;
    const boxEnd = Math.min(offset + size, end);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (sampleTableContainers.has(type)) {
      frames = Math.max(
        frames,
        avifSequenceFrameCount(bytes, offset + headerSize, boxEnd)
      );
    } else if (type === "stsz" && offset + headerSize + 12 <= boxEnd) {
      // After its version, flags and default sample size: the sample count.
      frames = Math.max(frames, readUint32(bytes, offset + headerSize + 8));
    }
    offset += size;
  }
  return frames;
};
