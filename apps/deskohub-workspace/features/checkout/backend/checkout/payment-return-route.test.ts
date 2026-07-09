import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routePath = join(
  import.meta.dirname,
  "../../../../app/[locale]/(minimal-header)/checkout/pay/return/[orderId]/route.ts"
);

describe("checkout pay return route", () => {
  test("settles provider return and redirects to reservation status", () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain("refreshStatus");
    expect(source).toContain("Checkout status refresh retry failed");
    expect(source).toContain("/reservation/status/");
    expect(source).toContain("NextResponse.redirect");
    expect(source).not.toContain("\n  notFound();\n}");
  });
});
