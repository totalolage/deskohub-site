import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";
import type {
  AdministrationCustomerReservationActivity,
  AdministrationCustomerReservationActivityCategory,
} from "./administration.service";
import { m } from "./i18n";
import {
  ReservationActivityCalendar,
  ReservationActivitySwatch,
  ReservationActivityTotal,
} from "./reservation-activity-calendar";

/** Product names are customer-facing content, so they come from its catalog. */
const reservationActivityCategoryStyles = {
  "cowork-open-space": {
    className: "bg-aquamarine-green/25",
    label: (locale) => getWorkspaceProductTierTitle("open-space", locale),
  },
  "cowork-reserved-desk": {
    className: "bg-aquamarine-green/70",
    label: (locale) => getWorkspaceProductTierTitle("reserved-desk", locale),
  },
  "cowork-basic": {
    className: "bg-aquamarine-green/25",
    label: (locale) => getWorkspaceProductTierTitle("basic", locale),
  },
  "cowork-plus": {
    className: "bg-aquamarine-green/70",
    label: (locale) => getWorkspaceProductTierTitle("plus", locale),
  },
  "cowork-profi": {
    className: "bg-[#10b981]",
    label: (locale) => getWorkspaceProductTierTitle("profi", locale),
  },
  "meeting-room": {
    className: "bg-[#60a5fa]",
    label: getWorkspaceMeetingRoomProductTitle,
  },
  office: {
    className: "bg-[#fb923c]",
    label: getWorkspaceOfficeProductTitle,
  },
} satisfies Record<
  AdministrationCustomerReservationActivityCategory,
  {
    readonly className: string;
    readonly label: (locale: Locale) => string;
  }
>;

export function CustomerReservationActivity({
  activity,
  locale,
}: {
  readonly activity: AdministrationCustomerReservationActivity;
  readonly locale: Locale;
}) {
  return (
    <section className="mb-7" aria-labelledby="reservation-activity-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl" id="reservation-activity-heading">
          {m.administrationReservationActivityTitle({}, { locale })}
        </h2>
        <ReservationActivityTotal activity={activity} locale={locale} />
      </div>
      <ReservationActivityCalendar
        activity={activity}
        getDayAppearance={({ category }) => ({
          className: reservationActivityCategoryStyles[category].className,
        })}
        legend={Object.values(reservationActivityCategoryStyles).map(
          ({ className, label }) => (
            <span
              className="inline-flex items-center gap-1.5"
              key={label(locale)}
            >
              <ReservationActivitySwatch className={className} />
              {label(locale)}
            </span>
          )
        )}
        locale={locale}
      />
    </section>
  );
}
