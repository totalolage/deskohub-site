import { describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("cs-CZ"),
}));

describe("logo variants route", () => {
  test("labels the page in the request locale", async () => {
    const { m } = await import("@/features/i18n");
    const { default: LogoPage } = await import("./page");

    const markup = renderToStaticMarkup((await LogoPage()) as ReactElement);

    expect(markup).toContain(m.logoVariantsTitle({}, { locale: "cs-CZ" }));
  });
});
