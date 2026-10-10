"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { FormEvent } from "react";
import { useForm } from "react-hook-form";
import { m } from "@/features/i18n";
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
import {
  nexiOperationChannels,
  nexiOperationTypes,
} from "./payment-administration-filters";
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
      <AdministrationFilterField htmlFor="order-from" label="From">
        <AdministrationFilterInput
          {...form.register("from")}
          aria-invalid={form.formState.errors.from ? true : undefined}
          defaultValue={range.from}
          id="order-from"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField htmlFor="order-to" label="To">
        <AdministrationFilterInput
          {...form.register("to")}
          aria-invalid={form.formState.errors.to ? true : undefined}
          defaultValue={range.to}
          id="order-to"
          type="date"
        />
      </AdministrationFilterField>
      <Button className="min-h-10" size="sm" type="submit">
        Show orders
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
      <AdministrationFilterField htmlFor="booking-date" label="Booking date">
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
      <Button className="min-h-10" size="sm" type="submit">
        Show bookings
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
      <AdministrationFilterField htmlFor="operation-from" label="From">
        <AdministrationFilterInput
          {...form.register("from")}
          aria-invalid={form.formState.errors.from ? true : undefined}
          defaultValue={range.from}
          id="operation-from"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField htmlFor="operation-to" label="To">
        <AdministrationFilterInput
          {...form.register("to")}
          aria-invalid={form.formState.errors.to ? true : undefined}
          defaultValue={range.to}
          id="operation-to"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField htmlFor="operation-channel" label="Origin">
        <AdministrationFilterSelect
          {...form.register("channel")}
          aria-invalid={form.formState.errors.channel ? true : undefined}
          defaultValue={input.channel ?? ""}
          id="operation-channel"
        >
          <option value="">All</option>
          {nexiOperationChannels.map((channel) => (
            <option key={channel} value={channel}>
              {channel.replaceAll("_", " ")}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField htmlFor="operation-operationType" label="Type">
        <AdministrationFilterSelect
          {...form.register("operationType")}
          aria-invalid={form.formState.errors.operationType ? true : undefined}
          defaultValue={input.operationType ?? ""}
          id="operation-operationType"
        >
          <option value="">All</option>
          {nexiOperationTypes.map((operationType) => (
            <option key={operationType} value={operationType}>
              {operationType.replaceAll("_", " ")}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <Button className="min-h-10" size="sm" type="submit">
        Show operations
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
        label="Deskohub status"
      >
        <AdministrationFilterSelect
          {...form.register("status")}
          aria-invalid={form.formState.errors.status ? true : undefined}
          defaultValue={input.status ?? ""}
          id="reservation-status"
        >
          <option value="">All statuses</option>
          <option value="in_progress">In progress</option>
          <option value="complete">Complete</option>
          <option value="cancelled">Cancelled</option>
          <option value="needs_refund">Needs refund</option>
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="reservation-type"
        label="Reservation type"
      >
        <AdministrationFilterSelect
          {...form.register("type")}
          aria-invalid={form.formState.errors.type ? true : undefined}
          defaultValue={input.type ?? ""}
          id="reservation-type"
        >
          <option value="">All reservation types</option>
          <option value="cowork">Coworking</option>
          <option value="meeting-room">Meeting room</option>
          <option value="office">{m.reservationOfficeProductTitle()}</option>
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="reservation-date-from"
        label="Start date from"
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
        label="Start date to"
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
          aria-label="Reservation date shortcuts"
          className="flex flex-wrap items-center gap-2"
        >
          {(
            [
              ["Today", shortcuts.today],
              ["Upcoming", shortcuts.upcoming],
              ["Past", shortcuts.past],
            ] as const
          ).map(([label, range]) => (
            <Button asChild key={label} size="sm" variant="secondary">
              <Link href={shortcutHref(range)}>{label}</Link>
            </Button>
          ))}
        </nav>
        <fieldset
          aria-label="Filter actions"
          className="flex min-w-0 items-center justify-end gap-2 border-0 p-0"
        >
          {(input.customerId ||
            input.from !== defaultFrom ||
            input.status ||
            input.to ||
            input.type) && (
            <Button asChild className="min-h-10" size="sm" variant="ghost">
              <Link href="/admin/reservations">Clear</Link>
            </Button>
          )}
          <Button className="min-h-10" size="sm" type="submit">
            Apply filters
          </Button>
        </fieldset>
      </div>
    </AdministrationFilterForm>
  );
}
