import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("cs-CZ"),
}));

test("keeps the pay page out of search results without naming its URL", async () => {
  const { generateMetadata } = await import("./page");
  const metadata = await generateMetadata();

  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(metadata.alternates).toBeUndefined();
  expect(metadata.openGraph?.url).toBeUndefined();
});
