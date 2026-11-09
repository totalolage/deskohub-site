import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { createCloudinaryCacheTags, createStableHash } from "./cache-tags";
import { CloudinaryPublicIdSchema } from "./schema";

/** An object nested `depth` levels deep with `leaf` at the bottom. */
const nested = (depth: number, leaf: unknown): unknown =>
  depth === 0 ? leaf : { child: nested(depth - 1, leaf) };

describe("createStableHash", () => {
  test("hashes the serialized value with a base-36 string hash", () => {
    expect(createStableHash("")).toBe("0");
    expect(createStableHash("a")).toBe((97).toString(36));
  });

  test("ignores object key order but not values", () => {
    expect(createStableHash({ b: 1, a: [2, 3] })).toBe(
      createStableHash({ a: [2, 3], b: 1 })
    );
    expect(createStableHash({ a: 1 })).not.toBe(createStableHash({ a: 2 }));
    expect(createStableHash([1, 2])).not.toBe(createStableHash([2, 1]));
  });

  test("spells null and undefined out like their strings", () => {
    expect(createStableHash(null)).toBe(createStableHash("null"));
    expect(createStableHash(undefined)).toBe(createStableHash("undefined"));
    expect(createStableHash({ a: null })).toBe(createStableHash({ a: "null" }));
    expect(createStableHash([undefined])).toBe(createStableHash(["undefined"]));
  });

  test("considers only the first 100 characters of a primitive", () => {
    const prefix = "x".repeat(100);

    expect(createStableHash(`${prefix}a`)).toBe(createStableHash(`${prefix}b`));
    expect(createStableHash(`${prefix}a`)).not.toBe(createStableHash(prefix));
    expect(createStableHash(prefix)).not.toBe(
      createStableHash(`${"x".repeat(99)}y`)
    );
  });

  test("marks circular references without recursing", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(createStableHash(circular)).toBe(
      createStableHash({ name: "loop", self: "[circular]" })
    );
  });

  test("serializes a shared, non-circular reference each time it appears", () => {
    const shared = { a: 1 };

    expect(createStableHash([shared, shared])).toBe(
      createStableHash([{ a: 1 }, { a: 1 }])
    );
  });

  test("stops descending below ten levels", () => {
    expect(createStableHash(nested(12, "a"))).toBe(
      createStableHash(nested(12, "b"))
    );
    expect(createStableHash(nested(11, "a"))).toBe(
      createStableHash(nested(11, "[...]"))
    );
    expect(createStableHash(nested(10, "a"))).not.toBe(
      createStableHash(nested(10, "b"))
    );
  });

  test("considers only the first 50 array items and object keys", () => {
    const items = Array.from({ length: 50 }, (_, index) => index);
    const fiftyKeys = Object.fromEntries(
      items.map((index) => [`k${String(index).padStart(2, "0")}`, 0])
    );

    expect(createStableHash([...items, "a"])).toBe(
      createStableHash([...items, "b"])
    );
    expect(createStableHash([...items, "a"])).not.toBe(createStableHash(items));
    expect(createStableHash({ ...fiftyKeys, zz: 1 })).toBe(
      createStableHash({ ...fiftyKeys, zz: 2 })
    );
    expect(createStableHash({ ...fiftyKeys, zz: 1 })).toBe(
      createStableHash(fiftyKeys)
    );
  });

  test("considers only the first 1000 serialized characters", () => {
    const longPrefix = Array.from({ length: 11 }, () => "y".repeat(100));

    expect(createStableHash([...longPrefix, "a"])).toBe(
      createStableHash([...longPrefix, "b"])
    );
  });
});

describe("createCloudinaryCacheTags", () => {
  const tags = createCloudinaryCacheTags({ namespace: "workspace" });
  const publicId = Schema.decodeUnknownSync(CloudinaryPublicIdSchema)(
    "gallery/image"
  );

  test("names the namespace-wide and per-image tags", () => {
    expect(tags.all()).toBe("workspace:all");
    expect(tags.image(publicId)).toBe("workspace:img:gallery/image");
    expect(tags.getTags()).toEqual(["workspace:all"]);
    expect(tags.getTags(publicId)).toEqual([
      "workspace:all",
      "workspace:img:gallery/image",
    ]);
  });

  test("adds a search tag's hash and limit only when given", () => {
    expect(tags.search()).toBe("workspace:search");
    expect(tags.search(["hero"])).toBe(
      `workspace:search:tags:${createStableHash(["hero"])}`
    );
    expect(tags.search(undefined, 12)).toBe("workspace:search:limit:12");
    expect(tags.search(["hero"], 12)).toBe(
      `workspace:search:tags:${createStableHash(["hero"])}:limit:12`
    );
  });
});
