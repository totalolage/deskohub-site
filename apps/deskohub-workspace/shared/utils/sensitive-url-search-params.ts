export const sensitiveUrlSearchParamKeys = [
  "_vercel_share",
  "checkouttoken",
  "message",
  "name",
  "paystate",
  "paystateref",
  "secret",
  "state",
  "token",
  "x-vercel-protection-bypass",
] as const;

const sensitiveUrlSearchParams = new Set<string>(sensitiveUrlSearchParamKeys);

const decodeSearchParamKey = (value: string, layers = 2) => {
  let decoded = value;
  for (let layer = 0; layer < layers; layer += 1) {
    try {
      const next = decodeURIComponent(decoded.replaceAll("+", " "));
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
};

export const isSensitiveUrlSearchParam = (key: string): boolean =>
  sensitiveUrlSearchParams.has(decodeSearchParamKey(key).toLowerCase());
