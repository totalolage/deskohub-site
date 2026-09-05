import { describe, expect, test } from "bun:test";

const workspaceRoot = new URL("../../", import.meta.url).pathname;

const readWorkspaceFile = (path: string) =>
  Bun.file(`${workspaceRoot}${path}`).text();

describe("administration UI boundaries", () => {
  test("keeps the administration frame in the instant shell", async () => {
    const layout = await readWorkspaceFile("app/admin/layout.tsx");

    expect(layout).toContain("export const instant = true");
    expect(layout).not.toContain("connection(");
    expect(layout).not.toContain("export default async function");
  });

  test("establishes the request boundary in shared page authorization", async () => {
    const sharedGate = await readWorkspaceFile(
      "shared/administrator/administrator-authorization.server.ts"
    );

    const pageGateStart = sharedGate.indexOf(
      "export const authorizeAdministratorPage"
    );
    const connectionCall = sharedGate.indexOf(
      "await connection()",
      pageGateStart
    );
    const requestHeaderCall = sharedGate.indexOf(
      "requireAdministratorAuthorization()",
      pageGateStart
    );

    expect(pageGateStart).toBeGreaterThanOrEqual(0);
    expect(connectionCall).toBeGreaterThan(pageGateStart);
    expect(requestHeaderCall).toBeGreaterThan(connectionCall);
    expect(sharedGate.match(/connection\(/g)).toHaveLength(1);

    for (const path of [
      "features/administration/page-data.server.ts",
      "features/discounts/admin/page-data.server.ts",
      "features/accounting/admin/page-data.server.ts",
      "features/accounting/admin/invoice-breadcrumb.server.ts",
      "features/admin-cli/page-data.server.ts",
      "app/admin/access-codes/page.tsx",
    ]) {
      const source = await readWorkspaceFile(path);

      expect(source).toContain("authorizeAdministratorPage");
      expect(source).toContain(
        'from "@/shared/administrator/administrator-authorization.server"'
      );
      expect(source).not.toContain("page-authorization.server");
      expect(source).not.toContain("connection(");
      expect(source).not.toMatch(/authorize[A-Za-z]+Page = cache/);
    }
  });

  test("creates invoice request identities only after user interaction", async () => {
    const source = await readWorkspaceFile(
      "features/accounting/admin/invoice-form.tsx"
    );

    expect(source.slice(0, source.indexOf("const openReview"))).not.toContain(
      "crypto.randomUUID()"
    );
  });

  test("streams data routes through local suspense boundaries", async () => {
    const dataRoutes = [
      "app/admin/page.tsx",
      "app/admin/bookings/page.tsx",
      "app/admin/bookings/[bookingId]/page.tsx",
      "app/admin/cli/authenticate/page.tsx",
      "app/admin/cli/sessions/page.tsx",
      "app/admin/codes/page.tsx",
      "app/admin/codes/[codeId]/page.tsx",
      "app/admin/customers/page.tsx",
      "app/admin/customers/[customerId]/page.tsx",
      "app/admin/customers/[customerId]/create-code/page.tsx",
      "app/admin/operations/page.tsx",
      "app/admin/operations/[operationId]/page.tsx",
      "app/admin/orders/page.tsx",
      "app/admin/orders/[orderId]/page.tsx",
      "app/admin/reservations/page.tsx",
      "app/admin/reservations/[reservationId]/page.tsx",
      "app/admin/sales/page.tsx",
    ];

    for (const route of dataRoutes) {
      const source = await readWorkspaceFile(route);
      expect(source).toContain("<Suspense");
      expect(source).not.toContain("export default async function");
    }
  });

  test("keeps low-level table and badge composition out of route pages", async () => {
    const pages = Array.from(
      new Bun.Glob("app/admin/**/page.tsx").scanSync({ cwd: workspaceRoot })
    );

    for (const page of pages) {
      const source = await readWorkspaceFile(page);
      expect(source).not.toContain("@/shared/components/ui/table");
      expect(source).not.toContain("@/shared/components/ui/badge");
    }
  });

  test("uses the shared toolbar on every administration collection", async () => {
    const collectionSurfaces = [
      "app/admin/bookings/page.tsx",
      "app/admin/cli/sessions/page.tsx",
      "app/admin/customers/page.tsx",
      "app/admin/operations/page.tsx",
      "app/admin/orders/page.tsx",
      "app/admin/reservations/page.tsx",
      "features/discounts/admin/components.tsx",
    ];

    for (const surface of collectionSurfaces) {
      expect(await readWorkspaceFile(surface)).toContain(
        "AdministrationTableToolbar"
      );
    }
  });

  test("keeps streamed counts in the shared accessible badge", async () => {
    const streamedCollections = [
      "app/admin/bookings/page.tsx",
      "app/admin/customers/page.tsx",
      "app/admin/operations/page.tsx",
      "app/admin/orders/page.tsx",
      "app/admin/reservations/page.tsx",
    ];

    for (const route of streamedCollections) {
      expect(await readWorkspaceFile(route)).toContain(
        "<AdministrationTableCount"
      );
    }
  });

  test("uses collection-shaped boundaries for codes and sales", async () => {
    for (const route of [
      "app/admin/codes/page.tsx",
      "app/admin/sales/page.tsx",
    ]) {
      const source = await readWorkspaceFile(route);
      expect(source).toContain("AdministrationTableToolbar");
      expect(source).toContain("AdministrationCollectionLoading");
      expect(source).not.toContain("AdministrationRouteLoading");
    }
  });

  test("loads narrow entity labels for detail breadcrumbs", async () => {
    const breadcrumbs = await readWorkspaceFile(
      "features/administration/breadcrumb.server.tsx"
    );

    expect(breadcrumbs).toContain("loadAdministrationBookingBreadcrumbLabel");
    expect(breadcrumbs).toContain(
      "loadAdministrationReservationBreadcrumbLabel"
    );
    expect(breadcrumbs).toContain("loadDiscountAdminCustomerBreadcrumbLabel");
    expect(breadcrumbs).toContain("loadInvoiceAdministrationBreadcrumbLabel");
    expect(breadcrumbs).not.toContain("loadAdministrationBooking(");
    expect(breadcrumbs).not.toContain("loadAdministrationReservation(");
    expect(breadcrumbs).not.toContain("loadInvoiceAdministrationDetail(");
    expect(breadcrumbs).not.toContain("InvoiceAdministrationService");
    expect(breadcrumbs).toContain(
      "@/features/accounting/admin/invoice-breadcrumb.server"
    );
    expect(breadcrumbs).not.toContain("accounting/admin/page-data.server");

    const breadcrumbLoader = await readWorkspaceFile(
      "features/accounting/admin/invoice-breadcrumb.server.ts"
    );
    expect(breadcrumbLoader).toContain("InvoiceBreadcrumbService");
    expect(breadcrumbLoader).not.toContain("InvoiceAdministrationService");
    expect(breadcrumbLoader).not.toContain("loadInvoiceAdministrationDetail(");

    const forbiddenBreadcrumbDependencies =
      /page-data\.server|invoice-administration\.service|invoice\.repository|snapshot|invoice-pdf|invoice-email-delivery|dotypos/i;
    for (const path of [
      "features/accounting/admin/invoice-breadcrumb.server.ts",
      "features/accounting/admin/invoice-breadcrumb.service.ts",
      "features/accounting/admin/invoice-administration-identifier.ts",
      "shared/administrator/administrator-authorization.server.ts",
    ]) {
      expect(await readWorkspaceFile(path)).not.toMatch(
        forbiddenBreadcrumbDependencies
      );
    }
    expect(forbiddenBreadcrumbDependencies.test("DotyposService")).toBe(true);
    expect(
      forbiddenBreadcrumbDependencies.test(
        "@/shared/backend/config/dotypos.config"
      )
    ).toBe(true);
    expect(
      forbiddenBreadcrumbDependencies.test(
        "@/features/accounting/backend/invoice-email-delivery.repository"
      )
    ).toBe(true);
  });

  test("keeps empty and sorting chrome in their shared foundations", async () => {
    const sourceFiles = [
      ...new Bun.Glob("app/admin/**/*.tsx").scanSync({ cwd: workspaceRoot }),
      ...new Bun.Glob("features/administration/**/*.tsx").scanSync({
        cwd: workspaceRoot,
      }),
      ...new Bun.Glob("features/discounts/admin/**/*.tsx").scanSync({
        cwd: workspaceRoot,
      }),
    ];
    const sources = await Promise.all(sourceFiles.map(readWorkspaceFile));

    expect(
      sources.filter((source) => source.includes("function EmptyState("))
    ).toHaveLength(1);
    expect(
      sources.filter((source) => source.includes("function SortIcon("))
    ).toHaveLength(0);
  });

  test("routes every administration table through the shared data table", async () => {
    for (const path of [
      "features/admin-cli/cli-sessions-table.tsx",
      "features/administration/booking-table.tsx",
      "features/administration/customer-table.tsx",
      "features/administration/payment-tables.tsx",
      "features/administration/reservation-table.tsx",
      "features/discounts/admin/admin-tables.tsx",
      "features/discounts/admin/customer-admin-tables.tsx",
    ]) {
      const source = await readWorkspaceFile(path);

      expect(source).toContain("AdministrationDataTable");
      expect(source).not.toContain("@/shared/components/ui/table");
    }
  });
});
