import { describe, expect, test } from "bun:test";

const pageSource = await Bun.file(
  new URL("./page.tsx", import.meta.url)
).text();

describe("customer account route boundary", () => {
  test("keeps request-bound account loading behind the localized suspense shell", () => {
    expect(pageSource).toContain("robots: { index: false, follow: false }");
    expect(pageSource).toContain('import { Suspense } from "react";');
    expect(pageSource).toContain(
      'import { AccountLoading } from "@/features/account/components/account-loading";'
    );
    expect(pageSource).toContain(
      "<Suspense fallback={<AccountLoading locale={locale} />}>"
    );
    expect(pageSource).toContain(
      "<CustomerAccountPageContent locale={locale} />"
    );
    expect(pageSource).toMatch(
      /async function CustomerAccountPageContent[\s\S]*await connection\(\)[\s\S]*await loadCustomerAccountPage\(locale\)/
    );

    const routeSource = pageSource.slice(pageSource.indexOf("export default"));
    const boundaryStart = routeSource.indexOf("<Suspense");
    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(routeSource.slice(0, boundaryStart)).not.toContain(
      "await connection()"
    );
    expect(routeSource.slice(0, boundaryStart)).not.toContain(
      "loadCustomerAccountPage"
    );
  });
});
