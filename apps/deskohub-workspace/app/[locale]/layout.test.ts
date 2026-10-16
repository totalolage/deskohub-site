import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";

mock.module("next/font/local", () => ({
  default: () => ({ variable: "--font-sculpin" }),
}));

const page = createElement("page");

describe("localized route layout", () => {
  test("rejects an unknown locale", async () => {
    const { default: LocaleLayout } = await import("./layout");
    await expect(
      LocaleLayout({
        children: page,
        params: Promise.resolve({ locale: "xx-XX" }),
      })
    ).rejects.toThrow();
  });
});
