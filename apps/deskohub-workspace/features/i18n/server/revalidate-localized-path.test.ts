import { expect, mock, test } from "bun:test";

import { getUnprefixedPagePath } from "../routing";

const revalidatedPaths: string[] = [];

mock.module("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

test("revalidates the page in every locale", async () => {
  const { revalidateLocalizedPath } = await import(
    "./revalidate-localized-path"
  );

  revalidateLocalizedPath(
    getUnprefixedPagePath("/[locale]/admin/invoices/[invoiceId]", {
      invoiceId: "invoice-id",
    })
  );

  expect(revalidatedPaths.sort()).toEqual([
    "/cs-CZ/admin/invoices/invoice-id",
    "/en-US/admin/invoices/invoice-id",
  ]);
});
