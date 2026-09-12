import { describe, expect, test } from "bun:test";

const pageSource = await Bun.file(
  new URL("./page.tsx", import.meta.url)
).text();

describe("cookie settings route boundary", () => {
  test("redirects every locale to the public account legal route", () => {
    expect(pageSource).not.toContain("CookieSettingsPage");
    expect(pageSource).toContain('import { redirect } from "next/navigation";');
    expect(pageSource).toContain(
      'import { runWithRequestLocale } from "@/features/i18n/server/request-locale";'
    );
    const localePlaceholder = "${" + "locale}";
    expect(pageSource).toContain(
      `redirect(\`/${localePlaceholder}/account/legal\`)`
    );
  });
});
