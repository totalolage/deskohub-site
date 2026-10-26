import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("cs-CZ"),
}));

test("opens the gallery page to search with its self-canonical alternates", async () => {
  const { generateMetadata } = await import("./page");
  const metadata = await generateMetadata();

  expect(metadata.robots).toBeUndefined();
  expect(metadata.alternates?.canonical).toBe(
    "https://workspace.deskohub.cz/cs-CZ/gallery"
  );
  expect(metadata.alternates?.languages).toHaveProperty("en-US");
});
