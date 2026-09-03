export type BetterAuthSecretEntry = {
  readonly version: number;
  readonly value: string;
};

export type BetterAuthSecretsMessage =
  | "BETTER_AUTH_SECRETS is not configured."
  | "BETTER_AUTH_SECRETS has an invalid entry format."
  | "BETTER_AUTH_SECRETS has duplicate versions."
  | "BETTER_AUTH_SECRETS has a weak secret value.";

export type BetterAuthSecretsParseResult =
  | {
      readonly kind: "valid";
      readonly secrets: [BetterAuthSecretEntry, ...BetterAuthSecretEntry[]];
    }
  | { readonly kind: "invalid"; readonly message: BetterAuthSecretsMessage };

const secretEntryPattern = /^([1-9][0-9]*):(.+)$/;

/**
 * The settled strength contract for Better Auth signing secrets: each value
 * carries at least 32 characters of entropy. Short values and obviously
 * low-entropy values (few distinct characters or a repeated short unit) are
 * rejected fail-closed without echoing any part of the value.
 */
const hasWeakSecretValue = (value: string): boolean => {
  if (value.length < 32) return true;

  if (new Set(value).size < 8) return true;

  const longestRepeatedUnit = Math.floor(value.length / 3);
  for (let unit = 1; unit <= longestRepeatedUnit; unit += 1) {
    if (value.length % unit !== 0) continue;
    const chunk = value.slice(0, unit);
    if (chunk.repeat(value.length / unit) === value) return true;
  }

  return false;
};

const parseSecretEntry = (entry: string): BetterAuthSecretEntry | undefined => {
  const match = secretEntryPattern.exec(entry.trim());
  if (!match) return undefined;
  return { version: Number(match[1]), value: match[2]!.trim() };
};

/**
 * Parses the versioned `BETTER_AUTH_SECRETS` environment value into the
 * Better Auth `secrets` option shape. The first entry signs new data; later
 * entries only decrypt retained envelopes. The result never echoes secret
 * values.
 */
export const parseBetterAuthSecrets = (
  raw: string | undefined
): BetterAuthSecretsParseResult => {
  if (!raw?.trim()) {
    return {
      kind: "invalid",
      message: "BETTER_AUTH_SECRETS is not configured.",
    };
  }

  const entries: BetterAuthSecretEntry[] = [];
  const versions = new Set<number>();
  for (const part of raw.split(",")) {
    const entry = parseSecretEntry(part);
    if (!entry?.value) {
      return {
        kind: "invalid",
        message: "BETTER_AUTH_SECRETS has an invalid entry format.",
      };
    }
    if (versions.has(entry.version)) {
      return {
        kind: "invalid",
        message: "BETTER_AUTH_SECRETS has duplicate versions.",
      };
    }
    versions.add(entry.version);
    entries.push(entry);
  }

  for (const entry of entries) {
    if (hasWeakSecretValue(entry.value)) {
      return {
        kind: "invalid",
        message: "BETTER_AUTH_SECRETS has a weak secret value.",
      };
    }
  }

  return {
    kind: "valid",
    secrets: [entries[0]!, ...entries.slice(1)],
  };
};
