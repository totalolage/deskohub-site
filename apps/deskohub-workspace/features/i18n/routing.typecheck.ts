import { getLocalizedPagePath, getUnprefixedPagePath } from "./routing";

const typecheck = false as boolean;

if (typecheck) {
  const administration: "/admin" = getUnprefixedPagePath("/[locale]/admin");
  const customer: `/admin/customers/${string}` = getUnprefixedPagePath(
    "/[locale]/admin/customers/[customerId]",
    { customerId: 1 }
  );
  const run: `/admin/email-campaigns/${string}/runs/${string}` =
    getUnprefixedPagePath(
      "/[locale]/admin/email-campaigns/[campaignId]/runs/[runId]",
      { campaignId: "campaign", runId: "run" }
    );
  void [administration, customer, run];

  // @ts-expect-error A route must exist in the app directory.
  getUnprefixedPagePath("/[locale]/admin/missing");

  // @ts-expect-error Routes outside the locale segment have no localized path.
  getUnprefixedPagePath("/api/mcp");

  // @ts-expect-error A catch-all route can't be filled.
  getUnprefixedPagePath("/[locale]/admin/[...catchAll]");

  // @ts-expect-error A dynamic route needs its parameters.
  getUnprefixedPagePath("/[locale]/admin/customers/[customerId]");

  // @ts-expect-error Every parameter is required.
  getUnprefixedPagePath("/[locale]/admin/customers/[customerId]", {});

  // @ts-expect-error A static route takes no parameters.
  getUnprefixedPagePath("/[locale]/admin", {});

  // @ts-expect-error A dynamic route needs its parameters.
  getLocalizedPagePath("cs-CZ", "/[locale]/account/[section]");
}
