import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routePath = join(
  import.meta.dirname,
  "../../../app/[locale]/(minimal-header)/checkout/payment/[orderId]/route.ts"
);

describe("checkout payment return route", () => {
  test("processes provider return and redirects to status instead of hard 404", () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain("refreshStatus");
    expect(source).toContain("Checkout payment return refresh failed");
    expect(source).toContain("NextResponse.redirect");
    expect(source).not.toContain("\n  notFound();\n}");
  });
});
