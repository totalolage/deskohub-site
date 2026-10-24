import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

test("keeps the cookie settings redirect out of search results", async () => {
  const { metadata } = await import("./page");

  expect(metadata.robots).toEqual({ index: false, follow: false });
});
