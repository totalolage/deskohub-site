"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { FormEvent } from "react";
import { useForm } from "react-hook-form";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
} from "@/features/checkout/product-catalog.i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { AdministrationLink as Link } from "./admin-link";
import {
  type AdministrationHref,
  administrationHref,
} from "./administration-href";
import { type BookingListQuery, bookingListQuery } from "./booking-list-query";
import {
  type CustomerListQuery,
  customerListQuery,
} from "./customer-list-query";
import { getAdministrationCustomerMarketingConsentLabel } from "./customer-presentation";
import {
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationFilterSelect,
} from "./filter-controls";
import { m } from "./i18n";
import {
  type OperationListQuery,
  operationListQuery,
} from "./operation-list-query";
import { type OrderListQuery, orderListQuery } from "./order-list-query";
import {
  nexiOperationChannels,
  nexiOperationTypes,
} from "./payment-administration-filters";
import { getProviderValueLabel } from "./payment-presentation";
import type {
  AdministrationReservationClosedDateRange,
  AdministrationReservationDateRange,
} from "./reservation-date-range";
import {
  type ReservationListQuery,
  reservationListQuery,
} from "./reservation-list-query";

type ReservationDateShortcuts = {
  readonly today: AdministrationReservationClosedDateRange;
  readonly upcoming: AdministrationReservationDateRange;
  readonly past: AdministrationReservationDateRange;
};

/** Links that apply a common reservation start-date range to a list. */
function ReservationDateShortcutLinks({
  getHref,
  shortcuts,
}: {
  readonly getHref: (
    range: AdministrationReservationDateRange
  ) => AdministrationHref;
  readonly shortcuts: ReservationDateShortcuts;
}) {
  const locale = useRouteLocale();
  return (
    <nav
      aria-label={m.administrationFilterReservationShortcuts({}, { locale })}
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
          <Link href={getHref(range)}>{label}</Link>
        </Button>
      ))}
    </nav>
  );
}

export function OrdersAdministrationFilterForm({
  query,
}: {
  readonly query: OrderListQuery;
}) {
  const locale = useRouteLocale();
  const values = orderListQuery.formValues(query);
  const form = useForm({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: standardSchemaResolver(orderListQuery.formSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action={administrationHref("/[locale]/admin/orders")}
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
          defaultValue={values.from}
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
          defaultValue={values.to}
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
  query,
}: {
  readonly query: BookingListQuery;
}) {
  const locale = useRouteLocale();
  const values = bookingListQuery.formValues(query);
  const form = useForm({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: standardSchemaResolver(bookingListQuery.formSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action={administrationHref("/[locale]/admin/bookings")}
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
          defaultValue={values.date}
          id="booking-date"
          required
          type="date"
        />
      </AdministrationFilterField>
      <input {...form.register("sort")} type="hidden" value={values.sort} />
      <input
        {...form.register("direction")}
        type="hidden"
        value={values.direction}
      />
      <Button size="md" type="submit">
        {m.administrationFilterShowBookings({}, { locale })}
      </Button>
    </AdministrationFilterForm>
  );
}

export function OperationsAdministrationFilterForm({
  query,
}: {
  readonly query: OperationListQuery;
}) {
  const locale = useRouteLocale();
  const values = operationListQuery.formValues(query);
  const form = useForm({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: standardSchemaResolver(operationListQuery.formSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action={administrationHref("/[locale]/admin/operations")}
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
          defaultValue={values.from}
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
          defaultValue={values.to}
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
          defaultValue={values.channel}
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
          defaultValue={values.operationType}
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
  query,
  shortcuts,
}: {
  readonly defaultFrom: string;
  readonly query: ReservationListQuery;
  readonly shortcuts: ReservationDateShortcuts;
}) {
  const locale = useRouteLocale();
  const values = reservationListQuery.formValues(query);
  const form = useForm({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: standardSchemaResolver(reservationListQuery.formSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action={administrationHref("/[locale]/admin/reservations")}
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
          defaultValue={values.status}
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
          defaultValue={values.type}
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
          defaultValue={values.from}
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
          defaultValue={values.to}
          id="reservation-date-to"
          type="date"
        />
      </AdministrationFilterField>
      {values.customerId && (
        <input
          {...form.register("customerId")}
          type="hidden"
          value={values.customerId}
        />
      )}
      <input {...form.register("sort")} type="hidden" value={values.sort} />
      <input
        {...form.register("direction")}
        type="hidden"
        value={values.direction}
      />
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between 2xl:col-span-4">
        <ReservationDateShortcutLinks
          getHref={(range) =>
            reservationListQuery.href({
              ...query,
              from: range.from,
              to: range.to,
            })
          }
          shortcuts={shortcuts}
        />
        <fieldset
          aria-label={m.administrationFilterActions({}, { locale })}
          className="flex min-w-0 items-center justify-end gap-2 border-0 p-0"
        >
          {(query.customerId ||
            query.from !== defaultFrom ||
            query.status ||
            query.to ||
            query.type) && (
            <Button asChild size="md" variant="ghost">
              <Link href={administrationHref("/[locale]/admin/reservations")}>
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

export function CustomersAdministrationFilterForm({
  query,
  shortcuts,
}: {
  readonly query: CustomerListQuery;
  readonly shortcuts: ReservationDateShortcuts;
}) {
  const locale = useRouteLocale();
  const values = customerListQuery.formValues(query);
  const form = useForm({
    defaultValues: values,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: standardSchemaResolver(customerListQuery.formSchema),
    values,
  });

  return (
    <AdministrationFilterForm
      action={administrationHref("/[locale]/admin/customers")}
      className="2xl:grid-cols-[12rem_10rem_10rem]"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        const nativeForm = event.currentTarget;
        void form.handleSubmit(() => nativeForm.submit())(event);
      }}
    >
      <AdministrationFilterField
        className="sm:col-span-2 2xl:col-span-1"
        htmlFor="customer-marketing-consent"
        label={m.administrationFilterCustomerMarketingConsent({}, { locale })}
      >
        <AdministrationFilterSelect
          {...form.register("marketingConsent")}
          aria-invalid={
            form.formState.errors.marketingConsent ? true : undefined
          }
          defaultValue={values.marketingConsent}
          id="customer-marketing-consent"
        >
          <option value="">
            {m.administrationFilterCustomerMarketingConsentAll({}, { locale })}
          </option>
          {customerListQuery.marketingConsentStates.map((state) => (
            <option key={state} value={state}>
              {getAdministrationCustomerMarketingConsentLabel(state, locale)}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="customer-reservation-from"
        label={m.administrationFilterCustomerReservationFrom({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("from")}
          aria-invalid={form.formState.errors.from ? true : undefined}
          defaultValue={values.from}
          id="customer-reservation-from"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="customer-reservation-to"
        label={m.administrationFilterCustomerReservationTo({}, { locale })}
      >
        <AdministrationFilterInput
          {...form.register("to")}
          aria-invalid={form.formState.errors.to ? true : undefined}
          defaultValue={values.to}
          id="customer-reservation-to"
          type="date"
        />
      </AdministrationFilterField>
      <input {...form.register("sort")} type="hidden" value={values.sort} />
      <input
        {...form.register("direction")}
        type="hidden"
        value={values.direction}
      />
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between 2xl:col-span-3">
        <ReservationDateShortcutLinks
          getHref={(range) =>
            customerListQuery.href({
              ...query,
              from: range.from,
              to: range.to,
            })
          }
          shortcuts={shortcuts}
        />
        <fieldset
          aria-label={m.administrationFilterActions({}, { locale })}
          className="flex min-w-0 items-center justify-end gap-2 border-0 p-0"
        >
          {(query.from || query.to || query.marketingConsent) && (
            <Button asChild size="md" variant="ghost">
              <Link href={administrationHref("/[locale]/admin/customers")}>
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
