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
});
