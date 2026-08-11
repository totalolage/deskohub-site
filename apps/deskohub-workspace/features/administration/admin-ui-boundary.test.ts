import { describe, expect, test } from "bun:test";

const workspaceRoot = new URL("../../", import.meta.url).pathname;

const readWorkspaceFile = (path: string) =>
  Bun.file(`${workspaceRoot}${path}`).text();

describe("administration UI boundaries", () => {
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
