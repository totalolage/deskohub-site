import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

test("keeps the logo page out of search results while crawlers follow its links", async () => {
  const { generateMetadata } = await import("./page");
  const metadata = await generateMetadata();

  expect(metadata.robots).toEqual({ index: false, follow: true });
  expect(metadata.alternates).toBeUndefined();
  expect(metadata.openGraph?.url).toBeUndefined();
});
