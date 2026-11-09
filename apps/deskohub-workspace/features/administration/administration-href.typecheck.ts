import {
  type AdministrationHref,
  administrationHref,
  localizeAdministrationHref,
} from "./administration-href";

const typecheck = false as boolean;

if (typecheck) {
  const invoice: AdministrationHref = administrationHref(
    "/[locale]/admin/invoices/[invoiceId]",
    { invoiceId: "invoice" }
  );
  const overview: AdministrationHref = administrationHref("/[locale]/admin");
  void [invoice, overview];

  // @ts-expect-error Only administration routes build administration hrefs.
  administrationHref("/[locale]/account");

  // @ts-expect-error A customer page isn't an administration href.
  localizeAdministrationHref("/account", "cs-CZ");

  // @ts-expect-error Other admin-prefixed paths aren't administration hrefs.
  localizeAdministrationHref("/administrators", "cs-CZ");
}
