// encryption.ts
import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  type KeyObject,
  randomBytes,
} from "node:crypto";

/**
 * Import a base64-encoded 32-byte key.
 * Must be 32 bytes for aes-256-gcm.
 */
function importKey(base64Key: string): KeyObject {
  const raw = Buffer.from(base64Key, "base64");
  if (raw.length !== 32) {
    throw new Error(
      "Invalid key length: expected 32 bytes (base64-encoded 256-bit key)"
    );
  }
  return createSecretKey(raw);
}

/**
 * AES-256-GCM encrypt.
 * Returns base64 of (iv + authTag + ciphertext).
 */
export function encryptAES256GCM(plaintext: string, base64Key: string): string {
  const key = importKey(base64Key);

  // 12-byte random IV (GCM standard recommend 12)
  const iv = randomBytes(12);

  // Create cipher
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encryptedBuffers = [cipher.update(plaintext, "utf8"), cipher.final()];
  const ciphertext = Buffer.concat(encryptedBuffers);

  // Authentication tag (16 bytes by default for GCM)
  const authTag = cipher.getAuthTag();

  // Combine iv | authTag | ciphertext
  const combined = Buffer.concat([iv, authTag, ciphertext]);

  return combined.toString("base64");
}

/**
 * AES-256-GCM decrypt.
 * Input must be base64 of (iv + authTag + ciphertext).
 */
export function decryptAES256GCM(data: string, base64Key: string): string {
  const key = importKey(base64Key);

  // Decode base64
  const raw = Buffer.from(data, "base64");

  // Recover iv | authTag | ciphertext
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28); // 16 bytes after IV
  const ciphertext = raw.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decryptedBuffers = [decipher.update(ciphertext), decipher.final()];
  const decrypted = Buffer.concat(decryptedBuffers);

  return decrypted.toString("utf8");
}
