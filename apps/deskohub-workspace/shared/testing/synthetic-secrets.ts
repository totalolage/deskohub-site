import { randomBytes } from "node:crypto";

export const generateSyntheticSecretValues = () => {
  const seed = randomBytes(32);
  const encodeWithOffset = (offset: number) => {
    const value = Buffer.from(seed);
    value[0] = ((value[0] ?? 0) + offset) % 256;
    return value.toString("base64url");
  };

  return [
    encodeWithOffset(0),
    encodeWithOffset(1),
    encodeWithOffset(2),
  ] as const;
};
