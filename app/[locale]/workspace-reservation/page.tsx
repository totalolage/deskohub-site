import { ReservationForm } from "@/features/workspace-reservation";
import { setLocale } from "@/i18n";
import type { RouteProps_locale } from "../route";

export default async function WorkspaceReservationPage({
  params,
}: RouteProps_locale) {
  setLocale((await params).locale);

  return (
    <div className="container mx-auto py-8">
      <ReservationForm />
    </div>
  );
}
