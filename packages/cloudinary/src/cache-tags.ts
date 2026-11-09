import type { CloudinaryPublicId } from "./schema";

const maxPrimitiveLength = 100;

/** `String(value)`, which spells `null` and `undefined` out, cut to 100 characters. */
const stringifyPrimitive = (value: unknown) => {
  const stringValue = String(value);
  return stringValue.length > maxPrimitiveLength
    ? `${stringValue.substring(0, maxPrimitiveLength)}...`
    : stringValue;
};

export function createStableHash(value: unknown): string {
  const seen = new WeakSet();
  const maxDepth = 10;
  const maxStringLength = 1000;

  const stringify = (nestedValue: unknown, depth = 0): string => {
    if (depth > maxDepth) {
      return "[...]";
    }

    if (nestedValue === null || typeof nestedValue !== "object") {
      return stringifyPrimitive(nestedValue);
    }

    if (seen.has(nestedValue)) {
      return "[circular]";
    }

    seen.add(nestedValue);

    if (Array.isArray(nestedValue)) {
      const items = nestedValue
        .slice(0, 50)
        .map((item) => stringify(item, depth + 1));
      seen.delete(nestedValue);
      return `[${items.join(",")}${nestedValue.length > 50 ? ",..." : ""}]`;
    }

    const sortedKeys = Object.keys(nestedValue).sort().slice(0, 50);
    const pairs = sortedKeys.map(
      (key) =>
        `${key}:${stringify((nestedValue as Record<string, unknown>)[key], depth + 1)}`
    );
    seen.delete(nestedValue);

    return `{${pairs.join(",")}}`;
  };

  const serialized = stringify(value);
  const truncatedSerialized =
    serialized.length > maxStringLength
      ? serialized.substring(0, maxStringLength)
      : serialized;

  let hash = 0;
  for (let index = 0; index < truncatedSerialized.length; index++) {
    hash = ((hash << 5) - hash + truncatedSerialized.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

export function createCloudinaryCacheTags({
  namespace,
}: {
  namespace: string;
}) {
  return {
    all: () => `${namespace}:all`,
    image: (publicId: CloudinaryPublicId) => `${namespace}:img:${publicId}`,
    search: (tags?: unknown, maxResults?: number) => {
      const parts = [`${namespace}:search`];

      if (tags) {
        parts.push(`tags:${createStableHash(tags)}`);
      }

      if (maxResults) {
        parts.push(`limit:${maxResults}`);
      }

      return parts.join(":");
    },
    getTags: (publicId?: CloudinaryPublicId) => {
      const tags = [`${namespace}:all`];

      if (publicId) {
        tags.push(`${namespace}:img:${publicId}`);
      }

      return tags;
    },
  };
}
