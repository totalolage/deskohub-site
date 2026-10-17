"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { FormEvent } from "react";
import { useForm } from "react-hook-form";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
} from "@/features/checkout/product-catalog.i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { AdministrationLink as Link } from "./admin-link";
import type { AdministrationReservationStatusFilter } from "./administration.service";
import {
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationFilterSelect,
} from "./filter-controls";
import {
  type BookingFilterValues,
  bookingFilterSchema,
  type OperationFilterValues,
  type OrderFilterValues,
  operationFilterSchema,
  orderFilterSchema,
  type ReservationFilterValues,
  reservationFilterSchema,
} from "./filter-schemas";
import { m } from "./i18n";
import {
  nexiOperationChannels,
  nexiOperationTypes,
} from "./payment-administration-filters";
import { getProviderValueLabel } from "./payment-presentation";
import type {
  AdministrationReservationClosedDateRange,
  AdministrationReservationDateRange,
} from "./reservation-date-range";

type DateRangeDefaults = {
  readonly from: string;
  readonly to: string;
};

export function OrdersAdministrationFilterForm({
  range,
}: {
  readonly range: DateRangeDefaults;
}) {
  const locale = useRouteLocale();
  const values: OrderFilterValues = { from: range.from, to: range.to };
  const form = useForm<OrderFilterValues>({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(orderFilterSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action="/admin/orders"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        const nativeForm = event.currentTarget;
        void form.handleSubmit(() => nativeForm.submit())(event);
      }}
      variant="standalone"
    >
      <AdministrationFilterField
        htmlFor="order-from"
        label={m.administrationFilterFrom({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("from")}
          aria-invalid={form.formState.errors.from ? true : undefined}
          defaultValue={range.from}
          id="order-from"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="order-to"
        label={m.administrationFilterTo({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("to")}
          aria-invalid={form.formState.errors.to ? true : undefined}
          defaultValue={range.to}
          id="order-to"
          type="date"
        />
      </AdministrationFilterField>
      <Button size="md" type="submit">
        {m.administrationFilterShowOrders({}, { locale })}
      </Button>
    </AdministrationFilterForm>
  );
}

export function BookingsAdministrationFilterForm({
  input,
}: {
  readonly input: {
    readonly date: string;
    readonly direction: "asc" | "desc";
    readonly sort: "booking" | "status";
  };
}) {
  const locale = useRouteLocale();
  const values: BookingFilterValues = {
    date: input.date,
    direction: input.direction,
    sort: input.sort,
  };
  const form = useForm<BookingFilterValues>({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(bookingFilterSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action="/admin/bookings"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        const nativeForm = event.currentTarget;
        void form.handleSubmit(() => nativeForm.submit())(event);
      }}
      variant="standalone"
    >
      <AdministrationFilterField
        htmlFor="booking-date"
        label={m.administrationFilterBookingDate({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("date")}
          aria-invalid={form.formState.errors.date ? true : undefined}
          defaultValue={input.date}
          id="booking-date"
          required
          type="date"
        />
      </AdministrationFilterField>
      <input {...form.register("sort")} type="hidden" value={input.sort} />
      <input
        {...form.register("direction")}
        type="hidden"
        value={input.direction}
      />
      <Button size="md" type="submit">
        {m.administrationFilterShowBookings({}, { locale })}
      </Button>
    </AdministrationFilterForm>
  );
}

export function OperationsAdministrationFilterForm({
  input,
  range,
}: {
  readonly input: {
    readonly channel?: (typeof nexiOperationChannels)[number];
    readonly operationType?: (typeof nexiOperationTypes)[number];
  };
  readonly range: DateRangeDefaults;
}) {
  const locale = useRouteLocale();
  const values: OperationFilterValues = {
    from: range.from,
    to: range.to,
    channel: input.channel ?? "",
    operationType: input.operationType ?? "",
  };
  const form = useForm<OperationFilterValues>({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(operationFilterSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action="/admin/operations"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        const nativeForm = event.currentTarget;
        void form.handleSubmit(() => nativeForm.submit())(event);
      }}
      variant="standalone"
    >
      <AdministrationFilterField
        htmlFor="operation-from"
        label={m.administrationFilterFrom({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("from")}
          aria-invalid={form.formState.errors.from ? true : undefined}
          defaultValue={range.from}
          id="operation-from"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="operation-to"
        label={m.administrationFilterTo({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("to")}
          aria-invalid={form.formState.errors.to ? true : undefined}
          defaultValue={range.to}
          id="operation-to"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="operation-channel"
        label={m.administrationFilterOperationOrigin({}, { locale })}
      >
        <AdministrationFilterSelect
          {...form.register("channel")}
          aria-invalid={form.formState.errors.channel ? true : undefined}
          defaultValue={input.channel ?? ""}
          id="operation-channel"
        >
          <option value="">
            {m.administrationFilterOperationAll({}, { locale })}
          </option>
          {nexiOperationChannels.map((channel) => (
            <option key={channel} value={channel}>
              {getProviderValueLabel(channel, locale)}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="operation-operationType"
        label={m.administrationFilterOperationType({}, { locale })}
      >
        <AdministrationFilterSelect
          {...form.register("operationType")}
          aria-invalid={form.formState.errors.operationType ? true : undefined}
          defaultValue={input.operationType ?? ""}
          id="operation-operationType"
        >
          <option value="">
            {m.administrationFilterOperationAll({}, { locale })}
          </option>
          {nexiOperationTypes.map((operationType) => (
            <option key={operationType} value={operationType}>
              {getProviderValueLabel(operationType, locale)}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <Button size="md" type="submit">
        {m.administrationFilterShowOperations({}, { locale })}
      </Button>
    </AdministrationFilterForm>
  );
}

export function ReservationsAdministrationFilterForm({
  defaultFrom,
  input,
  shortcuts,
}: {
  readonly defaultFrom: string;
  readonly input: {
    readonly customerId?: string;
    readonly direction?: "asc" | "desc";
    readonly from?: string;
    readonly sort?: "created" | "date" | "reservation" | "status";
    readonly status?: AdministrationReservationStatusFilter;
    readonly to?: string;
    readonly type?: "cowork" | "meeting-room" | "office";
  };
  readonly shortcuts: {
    readonly today: AdministrationReservationClosedDateRange;
    readonly upcoming: AdministrationReservationDateRange;
    readonly past: AdministrationReservationDateRange;
  };
}) {
  const locale = useRouteLocale();
  const values: ReservationFilterValues = {
    status: input.status ?? "",
    type: input.type ?? "",
    from: input.from ?? "",
    to: input.to ?? "",
    customerId: input.customerId,
    sort: input.sort ?? "created",
    direction: input.direction ?? "desc",
  };
  const form = useForm<ReservationFilterValues>({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(reservationFilterSchema),
    values,
  });
  const shortcutHref = (range: {
    readonly from?: string;
    readonly to?: string;
  }) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({
      customerId: input.customerId,
      direction: input.direction,
      from: range.from,
      sort: input.sort,
      status: input.status,
      to: range.to,
      type: input.type,
    })) {
      if (value) search.set(key, value);
    }
    return `/admin/reservations?${search.toString()}`;
  };

  return (
    <AdministrationFilterForm
      action="/admin/reservations"
      className="2xl:grid-cols-[10rem_12rem_10rem_10rem]"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        const nativeForm = event.currentTarget;
        void form.handleSubmit(() => nativeForm.submit())(event);
      }}
    >
      <AdministrationFilterField
        htmlFor="reservation-status"
        label={m.administrationFilterReservationStatus({}, { locale })}
      >
        <AdministrationFilterSelect
          {...form.register("status")}
          aria-invalid={form.formState.errors.status ? true : undefined}
          defaultValue={input.status ?? ""}
          id="reservation-status"
        >
          <option value="">
            {m.administrationFilterReservationStatusAll({}, { locale })}
          </option>
          <option value="in_progress">
            {m.administrationFilterReservationStatusInProgress({}, { locale })}
          </option>
          <option value="complete">
            {m.administrationFilterReservationStatusComplete({}, { locale })}
          </option>
          <option value="cancelled">
            {m.administrationFilterReservationStatusCancelled({}, { locale })}
          </option>
          <option value="needs_refund">
            {m.administrationFilterReservationStatusNeedsRefund({}, { locale })}
          </option>
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="reservation-type"
        label={m.administrationFilterReservationType({}, { locale })}
      >
        <AdministrationFilterSelect
          {...form.register("type")}
          aria-invalid={form.formState.errors.type ? true : undefined}
          defaultValue={input.type ?? ""}
          id="reservation-type"
        >
          <option value="">
            {m.administrationFilterReservationTypeAll({}, { locale })}
          </option>
          <option value="cowork">
            {m.administrationFilterReservationTypeCowork({}, { locale })}
          </option>
          <option value="meeting-room">
            {getWorkspaceMeetingRoomProductTitle(locale)}
          </option>
          <option value="office">
            {getWorkspaceOfficeProductTitle(locale)}
          </option>
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="reservation-date-from"
        label={m.administrationFilterReservationFrom({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("from")}
          aria-invalid={form.formState.errors.from ? true : undefined}
          defaultValue={input.from ?? ""}
          id="reservation-date-from"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="reservation-date-to"
        label={m.administrationFilterReservationTo({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("to")}
          aria-invalid={form.formState.errors.to ? true : undefined}
          defaultValue={input.to ?? ""}
          id="reservation-date-to"
          type="date"
        />
      </AdministrationFilterField>
      {input.customerId && (
        <input
          {...form.register("customerId")}
          type="hidden"
          value={input.customerId}
        />
      )}
      <input
        {...form.register("sort")}
        type="hidden"
        value={input.sort ?? "created"}
      />
      <input
        {...form.register("direction")}
        type="hidden"
        value={input.direction ?? "desc"}
      />
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between 2xl:col-span-4">
        <nav
          aria-label={m.administrationFilterReservationShortcuts(
            {},
            { locale }
          )}
          className="flex flex-wrap items-center gap-2"
        >
          {(
            [
              [
                "today",
                m.administrationFilterReservationToday({}, { locale }),
                shortcuts.today,
              ],
              [
                "upcoming",
                m.administrationFilterReservationUpcoming({}, { locale }),
                shortcuts.upcoming,
              ],
              [
                "past",
                m.administrationFilterReservationPast({}, { locale }),
                shortcuts.past,
              ],
            ] as const
          ).map(([id, label, range]) => (
            <Button asChild key={id} size="sm" variant="secondary">
              <Link href={shortcutHref(range)}>{label}</Link>
            </Button>
          ))}
        </nav>
        <fieldset
          aria-label={m.administrationFilterActions({}, { locale })}
          className="flex min-w-0 items-center justify-end gap-2 border-0 p-0"
        >
          {(input.customerId ||
            input.from !== defaultFrom ||
            input.status ||
            input.to ||
            input.type) && (
            <Button asChild size="md" variant="ghost">
              <Link href="/admin/reservations">
                {m.administrationFilterClear({}, { locale })}
              </Link>
            </Button>
          )}
          <Button size="md" type="submit">
            {m.administrationFilterApply({}, { locale })}
          </Button>
        </fieldset>
      </div>
    </AdministrationFilterForm>
  );
}
