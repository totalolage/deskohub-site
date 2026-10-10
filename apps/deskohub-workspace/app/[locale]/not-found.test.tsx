import { describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("cs-CZ"),
}));

describe("localized not-found page", () => {
  test("renders the copy and home link of the requested locale", async () => {
    const { m } = await import("@/features/i18n");
    const { default: NotFoundPage } = await import("./not-found");

    const markup = renderToStaticMarkup((await NotFoundPage()) as ReactElement);

    expect(markup).toContain(m.notFoundTitle({}, { locale: "cs-CZ" }));
    expect(markup).toContain(m.notFoundHomeLink({}, { locale: "cs-CZ" }));
    expect(markup).toContain('href="/cs-CZ"');
  });
});
