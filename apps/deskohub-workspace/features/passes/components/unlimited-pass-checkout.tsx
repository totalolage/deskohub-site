"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import {
  CheckoutFlowLayout,
  CheckoutSteps,
} from "@/features/checkout/components/checkout-flow-layout";
import { getWorkspaceProductMonitorTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { type OrderId, orderIdSchema } from "@/features/order";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { formatCount } from "@/shared/utils/number";
import { type PlainDate, plainDateStringSchema } from "@/shared/utils/temporal";
import { unlimitedPassDays } from "../pass-offer";
import { formatPassDate, getPassTierName } from "../pass-offer.i18n";
import type {
  PassPurchaseBuyer,
  passPurchaseDetailsSchema,
} from "../pass-purchase-details";
import type { UnlimitedPassSelection } from "../unlimited-pass";
import {
  getUnlimitedCheckoutPredecessors,
  getUnlimitedPassChoosePath,
  getUnlimitedPassDetailsPath,
  getUnlimitedPassPayPath,
  type UnlimitedPassAvailabilityData,
  type UnlimitedPassOptions,
  type UnlimitedPassOrderLink,
  unlimitedCheckoutPredecessorLimit,
} from "../unlimited-pass-checkout";
import {
  PassPurchasePay,
  type PassPurchasePaymentActions,
  type PassPurchasePayState,
} from "./pass-purchase-pay";
import {
  type UnlimitedPassAvailability,
  UnlimitedPassChoose,
} from "./unlimited-pass-choose";
import { UnlimitedPassDetails } from "./unlimited-pass-details";

type DetailsSchema = ReturnType<typeof passPurchaseDetailsSchema>;
type SubmittedOrder = Extract<UnlimitedPassOrderLink, { kind: "submitted" }>;
type CheckoutStep =
  | { readonly kind: "choose" }
  | { readonly kind: "details"; readonly selection: UnlimitedPassSelection }
  | {
      readonly kind: "pay";
      readonly orderId: OrderId;
      readonly selection: UnlimitedPassSelection;
      readonly state: PassPurchasePayState;
      readonly retry?: true;
    };
const checkoutStages = {
  choose: "chooseSpace",
  details: "contact",
  pay: "pay",
} as const;

type UnlimitedPassCheckoutProps = PassPurchasePaymentActions & {
  readonly locale: Locale;
  readonly buyer: PassPurchaseBuyer;
  readonly initialOptions: UnlimitedPassOptions;
  readonly initialStartDate?: PlainDate;
  readonly initialDetails?: UnlimitedPassSelection;
  readonly renewsPassId?: OrderId;
  readonly initialBounds: Pick<
    UnlimitedPassAvailabilityData,
    "today" | "lastStartDate"
  >;
  readonly draft?: UnlimitedPassOrderLink & {
    readonly holderEmail?: string | null;
  };
  readonly retryPayment?: {
    readonly orderId: OrderId;
    readonly selection: UnlimitedPassSelection;
    readonly state: PassPurchasePayState;
  };
  readonly discountCodeEntryEnabled: boolean;
  readonly getAvailability: (input: {
    locale: Locale;
    startsOn?: PlainDate;
    supersedeOrderIds?: readonly OrderId[];
  }) => Promise<{
    data?: UnlimitedPassAvailabilityData | { status: "unavailable" };
    serverError?: string;
  }>;
  readonly beginCheckout: (input: {
    orderId: OrderId;
    locale: Locale;
    selection: UnlimitedPassSelection;
    renewsPassId?: OrderId;
    supersedeOrderIds?: readonly OrderId[];
    buyerEmail: string;
    holderEmail?: string;
    recipientName?: string;
    buyerProfile?: DetailsSchema["Type"]["buyerProfile"];
  }) => Promise<{
    data?: (
      | (Omit<PassPurchasePayState, "billing"> & { status: "ready" })
      | { status: "signed_out" | "terms_changed" }
      | { status: "purchase_error"; reason: string }
      | {
          status: "capacity_unavailable" | "draft_voided";
          blockingDates: readonly string[];
        }
    ) & { readonly retiredPredecessorOrderIds?: readonly OrderId[] };
    serverError?: string;
  }>;
};

const wideCalendarQuery = "(min-width: 64rem)";
const subscribeCalendarWidth = (onChange: () => void) => {
  const media = window.matchMedia(wideCalendarQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const wideCalendar = () => window.matchMedia(wideCalendarQuery).matches;
const singleMonth = () => false;

export function UnlimitedPassCheckout({
  locale,
  buyer,
  initialOptions,
  initialStartDate,
  initialDetails,
  renewsPassId,
  initialBounds,
  draft,
  retryPayment,
  discountCodeEntryEnabled,
  getAvailability,
  beginCheckout,
  payCheckout,
  repriceCheckout,
}: UnlimitedPassCheckoutProps) {
  const fixedStartDate = renewsPassId ? initialStartDate : undefined;
  const [options, setOptions] = useState(initialOptions);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const firstVisibleDate =
      initialStartDate !== undefined &&
      Temporal.PlainDate.compare(initialStartDate, initialBounds.today) >= 0 &&
      Temporal.PlainDate.compare(
        initialStartDate,
        initialBounds.lastStartDate
      ) <= 0
        ? initialStartDate
        : initialBounds.today;
    return plainDateStringSchema.make(
      Temporal.PlainDate.from(firstVisibleDate).with({ day: 1 }).toString()
    );
  });
  const [step, setStep] = useState<CheckoutStep>(() => {
    if (retryPayment) return { kind: "pay", retry: true, ...retryPayment };
    if (initialDetails) return { kind: "details", selection: initialDetails };
    return { kind: "choose" };
  });
  const [paymentRequested, setPaymentRequested] = useState(false);
  const [details, setDetails] = useState<DetailsSchema["Encoded"] | undefined>(
    !renewsPassId && draft?.holderEmail
      ? {
          holderEmail: draft.holderEmail,
          billing: defaultReservationBillingSelection,
        }
      : undefined
  );
  const [error, setError] = useState<string>();
  const [order, setOrder] = useState<UnlimitedPassOrderLink | undefined>(draft);
  const detailRevision = useRef(0);
  useEffect(
    () => () => {
      detailRevision.current += 1;
    },
    []
  );
  const beginPending = useRef(false);
  const [isBeginning, setBeginning] = useState(false);
  const detailsDraft = useRef<() => DetailsSchema["Encoded"]>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const submittedHolder = useRef(
    draft && (draft.kind === "resume" || draft.holderEmail !== undefined)
      ? { email: draft.holderEmail ?? undefined }
      : undefined
  );
  const isWide = useSyncExternalStore(
    subscribeCalendarWidth,
    wideCalendar,
    singleMonth
  );
  const firstMonth = Temporal.PlainDate.from(initialBounds.today).with({
    day: 1,
  });
  const lastMonth = Temporal.PlainDate.from(initialBounds.lastStartDate).with({
    day: 1,
  });
  const numberOfMonths = isWide && !firstMonth.equals(lastMonth) ? 2 : 1;
  const latestFirstVisibleMonth = lastMonth.subtract({
    months: numberOfMonths - 1,
  });
  const displayedMonth =
    Temporal.PlainDate.compare(calendarMonth, latestFirstVisibleMonth) > 0
      ? plainDateStringSchema.make(latestFirstVisibleMonth.toString())
      : calendarMonth;
  const startsOn =
    Temporal.PlainDate.compare(displayedMonth, initialBounds.today) > 0
      ? displayedMonth
      : undefined;
  const predecessorOrderIds = getUnlimitedCheckoutPredecessors(order);
  const availability = useQuery({
    queryKey: [
      "unlimited-pass-availability",
      locale,
      startsOn,
      predecessorOrderIds,
    ],
    queryFn: async () => {
      const fallback = m.reservationAvailabilityError({}, { locale });
      const result = await getAvailability({
        locale,
        ...(startsOn !== undefined && { startsOn }),
        ...(predecessorOrderIds.length > 0 && {
          supersedeOrderIds: predecessorOrderIds,
        }),
      }).catch(() => ({
        data: undefined,
        serverError: fallback,
      }));
      if (result.data?.status !== "ready")
        throw new Error(result.serverError ?? fallback);
      return result.data;
    },
    enabled: step.kind === "choose",
    retry: false,
  });
  // While refreshing, wait for a new result before moving on from Choose.
  let calendarAvailability: UnlimitedPassAvailability = { status: "loading" };
  if (!availability.isFetching) {
    if (availability.isError) {
      calendarAvailability = {
        status: "unavailable",
        message: availability.error.message,
      };
    } else if (availability.data) {
      calendarAvailability = {
        status: "ready",
        starts: availability.data.starts,
      };
    }
  }

  const focusStep = (next: CheckoutStep, nextError?: string) => {
    detailRevision.current += 1;
    setError(nextError);
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  };

  const goToChoose = () => {
    if (beginPending.current) return;
    if (detailsDraft.current) setDetails(detailsDraft.current());
    window.history.replaceState(
      null,
      "",
      getUnlimitedPassChoosePath(
        locale,
        options,
        startDate,
        order,
        renewsPassId
      )
    );
    focusStep({ kind: "choose" });
  };

  const updateSelection = (
    nextOptions: UnlimitedPassOptions,
    nextDate?: PlainDate
  ) => {
    if (predecessorOrderIds.length > unlimitedCheckoutPredecessorLimit) {
      setError(m.actionFailedUnexpectedly({}, { locale }));
      return;
    }
    const editedOrder = editOrder(order);
    setOrder(editedOrder);
    setError(undefined);
    setOptions(nextOptions);
    const date = fixedStartDate ?? nextDate;
    setStartDate(date);
    window.history.replaceState(
      null,
      "",
      getUnlimitedPassChoosePath(
        locale,
        nextOptions,
        date,
        editedOrder,
        renewsPassId
      )
    );
  };

  const goToDetails = (
    selection: UnlimitedPassSelection,
    order?: UnlimitedPassOrderLink
  ) => {
    window.history.replaceState(
      null,
      "",
      getUnlimitedPassDetailsPath(locale, selection, order, renewsPassId)
    );
    focusStep({ kind: "details", selection });
  };

  const submitDetails = async (values: DetailsSchema["Type"]) => {
    if (
      step.kind !== "details" ||
      beginPending.current ||
      (buyer.kind !== "linked" && buyer.kind !== "profile-required")
    )
      return;
    const { selection } = step;
    setError(undefined);
    const { recipientName, ...draftDetails } = values;
    setDetails(draftDetails);
    const enteredHolder = renewsPassId
      ? undefined
      : draftDetails.holderEmail?.toLowerCase();
    const holderEmail =
      enteredHolder === buyer.email.toLowerCase() ? undefined : enteredHolder;
    let submission: SubmittedOrder;
    const sameHolder =
      !submittedHolder.current ||
      submittedHolder.current.email?.toLowerCase() === holderEmail;
    if (sameHolder && order?.kind === "submitted") {
      submission = order;
    } else if (sameHolder && order?.kind === "resume") {
      submission = {
        kind: "submitted",
        orderId: order.orderId,
        predecessorOrderIds: [],
      };
    } else {
      if (predecessorOrderIds.length > unlimitedCheckoutPredecessorLimit) {
        setError(m.actionFailedUnexpectedly({}, { locale }));
        return;
      }
      submission = {
        kind: "submitted",
        orderId: orderIdSchema.make(crypto.randomUUID()),
        predecessorOrderIds,
      };
    }
    submittedHolder.current = { email: holderEmail };
    const revision = ++detailRevision.current;
    beginPending.current = true;
    setBeginning(true);
    const saveOrder = (order: UnlimitedPassOrderLink) => {
      window.history.replaceState(
        null,
        "",
        getUnlimitedPassDetailsPath(locale, selection, order, renewsPassId)
      );
      setOrder(order);
    };
    const beginSubmission = async (attempt: SubmittedOrder) => {
      saveOrder(attempt);
      const result = await beginCheckout({
        orderId: attempt.orderId,
        locale,
        selection,
        ...(renewsPassId && { renewsPassId }),
        ...(attempt.predecessorOrderIds.length > 0 && {
          supersedeOrderIds: attempt.predecessorOrderIds,
        }),
        buyerEmail: buyer.email,
        ...(holderEmail !== undefined && { holderEmail }),
        ...(holderEmail !== undefined &&
          recipientName !== undefined && {
            recipientName,
          }),
        ...(values.buyerProfile !== undefined && {
          buyerProfile: values.buyerProfile,
        }),
      });
      const retired = result.data?.retiredPredecessorOrderIds;
      if (detailRevision.current === revision && retired?.length) {
        submission = {
          ...attempt,
          predecessorOrderIds: attempt.predecessorOrderIds.filter(
            (orderId) => !retired.includes(orderId)
          ),
        };
        saveOrder(submission);
      }
      return result;
    };
    try {
      let result = await beginSubmission(submission);
      if (detailRevision.current !== revision) return;
      if (
        result.data?.status === "purchase_error" &&
        result.data.reason === "draft-changed" &&
        submission.predecessorOrderIds.length <
          unlimitedCheckoutPredecessorLimit
      ) {
        submission = {
          kind: "submitted",
          orderId: orderIdSchema.make(crypto.randomUUID()),
          predecessorOrderIds: [
            submission.orderId,
            ...submission.predecessorOrderIds,
          ],
        };
        result = await beginSubmission(submission);
      }
      if (detailRevision.current !== revision) return;
      const { orderId } = submission;
      if (result.data?.status === "signed_out") {
        window.location.assign(
          getAccountSignInPath(
            locale,
            getUnlimitedPassDetailsPath(
              locale,
              selection,
              submission,
              renewsPassId
            )
          )
        );
      } else if (result.data?.status === "ready") {
        if (submission.predecessorOrderIds.length === 0) {
          saveOrder({ kind: "resume", orderId });
        }
        setPaymentRequested(false);
        focusStep({
          kind: "pay",
          orderId,
          selection,
          state: {
            ...result.data,
            billing: values.billing,
            ...(holderEmail !== undefined && { holderEmail }),
          },
        });
      } else if (
        result.data?.status === "capacity_unavailable" ||
        result.data?.status === "draft_voided"
      ) {
        const remaining = submission.predecessorOrderIds;
        const edit: UnlimitedPassOrderLink | undefined = remaining.length
          ? { kind: "edit", predecessorOrderIds: remaining }
          : undefined;
        setOrder(edit);
        setStartDate(fixedStartDate);
        window.history.replaceState(
          null,
          "",
          getUnlimitedPassChoosePath(
            locale,
            options,
            fixedStartDate,
            edit,
            renewsPassId
          )
        );
        if (
          predecessorOrderIds.length === remaining.length &&
          remaining.every((id, index) => id === predecessorOrderIds[index])
        ) {
          void availability.refetch();
        }
        const dates = new Intl.ListFormat(locale).format(
          result.data.blockingDates.map((date) => formatPassDate(date, locale))
        );
        const blockingDatesMessage = renewsPassId
          ? m.unlimitedPassCheckoutRenewalBlockingDates
          : m.unlimitedPassCheckoutBlockingDates;
        const unavailableMessage = renewsPassId
          ? m.unlimitedPassCheckoutNoStarts
          : m.unlimitedPassCheckoutStartUnavailable;
        focusStep(
          { kind: "choose" },
          dates
            ? blockingDatesMessage({ dates }, { locale })
            : unavailableMessage({}, { locale })
        );
      } else {
        setError(
          result.serverError ?? m.actionFailedUnexpectedly({}, { locale })
        );
      }
    } catch {
      if (detailRevision.current === revision) {
        setError(m.actionFailedUnexpectedly({}, { locale }));
      }
    } finally {
      beginPending.current = false;
      setBeginning(false);
    }
  };

  const stage = checkoutStages[step.kind];
  const days = formatCount(unlimitedPassDays, locale);
  return (
    <CheckoutFlowLayout
      activeStepKey={stage}
      locale={locale}
      steps={
        <CheckoutSteps
          activeStepKey={stage}
          label={m.unlimitedPassCheckoutSteps({}, { locale })}
          labels={{
            chooseSpace: m.unlimitedPassCheckoutChoose({ days }, { locale }),
            contact: m.unlimitedPassCheckoutHolder({}, { locale }),
          }}
          locale={locale}
          stepLinks={{
            ...(step.kind === "details" &&
              !isBeginning && {
                chooseSpace: { onSelect: () => goToChoose() },
              }),
            ...(step.kind === "pay" &&
              !step.retry &&
              !paymentRequested && {
                contact: {
                  onSelect: () => goToDetails(step.selection, order),
                },
              }),
          }}
        />
      }
    >
      {step.kind !== "pay" && (
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-4xl leading-tight text-balance sm:text-5xl"
        >
          {m.unlimitedPassCheckoutTitle({}, { locale })}
        </h1>
      )}
      {step.kind === "choose" && (
        <>
          <p role="alert" className="empty:sr-only text-sm font-semibold">
            {error}
          </p>
          <UnlimitedPassChoose
            locale={locale}
            today={availability.data?.today ?? initialBounds.today}
            lastStartDate={initialBounds.lastStartDate}
            calendarMonth={displayedMonth}
            numberOfMonths={numberOfMonths}
            options={options}
            startDate={startDate}
            fixedStartDate={fixedStartDate}
            availability={calendarAvailability}
            onOptionsChange={updateSelection}
            onMonthChange={setCalendarMonth}
            onStartDateChange={(next) => updateSelection(options, next)}
            onRetry={() => void availability.refetch()}
            onContinue={(selection) => goToDetails(selection, order)}
          />
        </>
      )}
      {step.kind === "details" && (
        <UnlimitedPassDetails
          buyer={buyer}
          locale={locale}
          selection={step.selection}
          initialValues={details}
          draftRef={detailsDraft}
          order={order}
          renewsPassId={renewsPassId}
          error={error}
          onChangeSelection={goToChoose}
          onSubmit={submitDetails}
        />
      )}
      {step.kind === "pay" && (
        <PassPurchasePay
          locale={locale}
          orderId={step.orderId}
          state={step.state}
          product="unlimited"
          orderLabel={m.unlimitedPassCheckoutOrderLabel(
            { tier: getPassTierName(step.selection.tier, locale) },
            { locale }
          )}
          orderDetail={getOrderDetail(step.selection, locale, days)}
          returnExpiredQuoteToStatus={step.retry === true}
          repriceCheckout={repriceCheckout}
          payCheckout={payCheckout}
          discountCodeEntryEnabled={discountCodeEntryEnabled && !step.retry}
          signInPath={getAccountSignInPath(
            locale,
            step.retry
              ? getUnlimitedPassPayPath(locale, step.orderId)
              : getUnlimitedPassDetailsPath(
                  locale,
                  step.selection,
                  order,
                  renewsPassId
                )
          )}
          headingRef={heading}
          onRequestPayment={() => setPaymentRequested(true)}
          onExpire={() => {
            const editedOrder =
              predecessorOrderIds.length > unlimitedCheckoutPredecessorLimit
                ? order
                : editOrder(order);
            setOrder(editedOrder);
            setDetails({ ...details, billing: step.state.billing });
            goToDetails(step.selection, editedOrder);
          }}
        />
      )}
    </CheckoutFlowLayout>
  );
}

function getOrderDetail(
  selection: UnlimitedPassSelection,
  locale: Locale,
  days: string
) {
  if (selection.tier === "reserved-desk-workstation") {
    return getWorkspaceProductMonitorTitle(selection.monitorOption, locale);
  }
  if (selection.tier === "open-space" && selection.coffee) {
    return m.unlimitedPassCheckoutCoffee({ days }, { locale });
  }
}

function editOrder(
  order?: UnlimitedPassOrderLink
): UnlimitedPassOrderLink | undefined {
  if (!order || order.kind === "edit" || order.kind === "replace") return order;
  return {
    kind: "edit",
    predecessorOrderIds: getUnlimitedCheckoutPredecessors(order),
  };
}
