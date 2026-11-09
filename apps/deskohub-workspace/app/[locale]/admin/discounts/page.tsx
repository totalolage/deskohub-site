import { redirect } from "next/navigation";
import { administrationHref } from "@/features/administration/administration-href";

export default function DiscountAdminPage() {
  // The proxy redirects this unprefixed path to the operator's locale.
  redirect(administrationHref("/[locale]/admin/codes"));
}
