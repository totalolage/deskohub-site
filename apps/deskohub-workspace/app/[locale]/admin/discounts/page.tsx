import { redirect } from "next/navigation";

export default function DiscountAdminPage() {
  // The proxy redirects this unprefixed path to the operator's locale.
  redirect("/admin/codes");
}
