import { type Locale, m } from "@/features/i18n";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import {
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { coworkReservationPath } from "@/features/reservation/routes";
import {
  CoworkReservationForm,
  CoworkReservationFormFallback,
} from "./cowork-reservation-form";

export const coworkReservationPage = createReservationPage({
  fallback: (locale) => <CoworkReservationFormFallback locale={locale} />,
  kind: "cowork",
  pathname: coworkReservationPath,
  metadata: (locale: Locale) => ({
    title: m.checkoutOrderMetadataTitle({}, { locale }),
    description: m.checkoutOrderMetadataDescription({}, { locale }),
  }),
  render: ({
    checkoutSessionId,
    initialReservation,
    locale,
    replacementToken,
    searchParams,
  }) => {
    const restoredOrQueryValues = initialReservation
      ? getReservationDefaultValuesFromPayState(initialReservation)
      : getReservationDefaultValuesFromSearchParams(searchParams);
    const initialValues = restoredOrQueryValues.date
      ? restoredOrQueryValues
      : {
          ...restoredOrQueryValues,
          date: getCurrentWorkspaceDate().toString(),
        };

    return (
      <CoworkReservationForm
        checkoutSessionId={checkoutSessionId}
        initialReservation={initialReservation}
        initialValues={initialValues}
        locale={locale}
        replacementToken={replacementToken}
      />
    );
  },
});
