import { describe, expect, test } from "bun:test";

const loadingSource = await Bun.file(
  new URL("./loading.tsx", import.meta.url)
).text();

describe("account route loading boundary", () => {
  test("renders the localized account content fallback without replacing the shell", () => {
    expect(loadingSource).toContain(
      'import { AccountContentLoading } from "@/features/account/components/account-loading";'
    );
    expect(loadingSource).toContain(
      'import { runWithRequestLocale } from "@/features/i18n/server/request-locale";'
    );
    expect(loadingSource).toContain(
      "<AccountContentLoading locale={locale} />"
    );
    expect(loadingSource).not.toContain("AccountLoading");
  });
});
