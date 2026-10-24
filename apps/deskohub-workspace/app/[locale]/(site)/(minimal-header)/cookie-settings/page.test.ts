import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

test("keeps the cookie settings redirect out of search results", async () => {
  const { metadata } = await import("./page");

  expect(metadata.robots).toEqual({ index: false, follow: false });
});
