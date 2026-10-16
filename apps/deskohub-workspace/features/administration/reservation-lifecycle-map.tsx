import { ArrowDown, ArrowRight, Check, CircleAlert } from "lucide-react";
import type { Locale } from "@/features/i18n";
import { cn } from "@/shared/utils";
import { m } from "./i18n";
import { getAdministrationLifecycleConditionLabel } from "./reservation-presentation";
import type {
  AdministrationLifecycleStage,
  AdministrationReservationLifecycle,
} from "./reservation-status";

type LifecycleStageMessage =
  typeof m.administrationReservationLifecycleStageHeld;

const lifecycleStages = [
  {
    stage: "started",
    label: m.administrationReservationLifecycleStageStarted,
    note: m.administrationReservationLifecycleStageStartedNote,
  },
  {
    stage: "held",
    label: m.administrationReservationLifecycleStageHeld,
    note: m.administrationReservationLifecycleStageHeldNote,
  },
  {
    stage: "paid",
    label: m.administrationReservationLifecycleStagePaid,
    note: m.administrationReservationLifecycleStagePaidNote,
  },
  {
    stage: "complete",
    label: m.administrationReservationLifecycleStageComplete,
    note: m.administrationReservationLifecycleStageCompleteNote,
  },
] as const;

type CancellationLifecycleStage = Extract<
  AdministrationLifecycleStage,
  "hold_expired" | "cancelling" | "cancellation_failed" | "cancelled"
>;

const cancellationStagePresentation = {
  hold_expired: {
    label: m.administrationReservationLifecycleStageHoldExpired,
    note: m.administrationReservationLifecycleStageHoldExpiredNote,
  },
  cancelling: {
    label: m.administrationReservationLifecycleStageCancelling,
    note: m.administrationReservationLifecycleStageCancellingNote,
  },
  cancellation_failed: {
    label: m.administrationReservationLifecycleStageCancellationIssue,
    note: m.administrationReservationLifecycleStageCancellationIssueNote,
  },
  cancelled: {
    label: m.administrationReservationLifecycleStageCancelled,
    note: m.administrationReservationLifecycleStageCancelledNote,
  },
} satisfies Record<
  CancellationLifecycleStage,
  {
    readonly label: LifecycleStageMessage;
    readonly note: LifecycleStageMessage;
  }
>;

const isCancellationStage = (
  stage: AdministrationLifecycleStage
): stage is CancellationLifecycleStage =>
  stage in cancellationStagePresentation;

export function ReservationLifecycleMap({
  lifecycle,
  locale,
}: {
  readonly lifecycle: AdministrationReservationLifecycle;
  readonly locale: Locale;
}) {
  const cancellationStage = isCancellationStage(lifecycle.currentStage)
    ? lifecycle.currentStage
    : "cancelled";
  const cancellation = cancellationStagePresentation[cancellationStage];
  const [started, held, paid, complete] = lifecycleStages;
  return (
    <div className="rounded-xl border border-navy-blue/10 bg-white p-4 sm:p-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        <LifecycleStageCard
          className="md:col-start-1 md:row-start-1"
          lifecycle={lifecycle}
          locale={locale}
          {...started}
        />
        <LifecycleConnector
          className="md:col-start-2 md:row-start-1"
          reached={lifecycle.reachedStages.includes("held")}
        />
        <LifecycleStageCard
          className="md:col-start-3 md:row-start-1"
          lifecycle={lifecycle}
          locale={locale}
          {...held}
        />

        <div className="md:col-start-3 md:row-start-2">
          <ArrowDown
            aria-hidden
            className={cn(
              "mx-auto mb-3 size-4",
              isCancellationStage(lifecycle.currentStage)
                ? "text-navy-blue/55"
                : "text-navy-blue/18"
            )}
          />
          <LifecycleStageCard
            label={cancellation.label}
            lifecycle={lifecycle}
            locale={locale}
            note={cancellation.note}
            stage={cancellationStage}
          />
        </div>

        <LifecycleConnector
          className="md:col-start-4 md:row-start-1"
          mobileLabel={m.administrationReservationLifecycleContinueToPayment(
            {},
            { locale }
          )}
          reached={lifecycle.reachedStages.includes("paid")}
        />
        <LifecycleStageCard
          className="md:col-start-5 md:row-start-1"
          lifecycle={lifecycle}
          locale={locale}
          {...paid}
        />
        <LifecycleConnector
          className="md:col-start-6 md:row-start-1"
          reached={lifecycle.reachedStages.includes("complete")}
        />
        <LifecycleStageCard
          className="md:col-start-7 md:row-start-1"
          lifecycle={lifecycle}
          locale={locale}
          {...complete}
        />
      </div>
    </div>
  );
}

function LifecycleConnector({
  className,
  mobileLabel,
  reached,
}: {
  readonly className?: string;
  readonly mobileLabel?: string;
  readonly reached: boolean;
}) {
  const color = reached ? "text-navy-blue/55" : "text-navy-blue/18";
  return (
    <div className={cn("grid justify-items-center", className)}>
      {mobileLabel && (
        <span className="mb-1 text-xs font-semibold text-navy-blue/55 md:hidden">
          {mobileLabel}
        </span>
      )}
      <ArrowDown aria-hidden className={cn("size-4 md:hidden", color)} />
      <ArrowRight aria-hidden className={cn("hidden size-4 md:block", color)} />
    </div>
  );
}

function LifecycleStageCard({
  className,
  label,
  lifecycle,
  locale,
  note,
  stage,
}: {
  readonly className?: string;
  readonly label: LifecycleStageMessage;
  readonly lifecycle: AdministrationReservationLifecycle;
  readonly locale: Locale;
  readonly note: LifecycleStageMessage;
  readonly stage: AdministrationLifecycleStage;
}) {
  const current = lifecycle.currentStage === stage;
  const reached = lifecycle.reachedStages.includes(stage);
  const attention = current && lifecycle.tone === "attention";
  return (
    <div
      aria-current={current ? "step" : undefined}
      className={cn(
        "relative min-h-20 rounded-xl border px-4 py-3",
        !reached &&
          "border-navy-blue/10 bg-navy-blue/[0.018] text-navy-blue/60",
        reached && !current && "border-navy-blue/15 bg-white text-navy-blue/70",
        current &&
          !attention &&
          "border-aquamarine-green/60 bg-aquamarine-green/[0.07] text-navy-blue",
        attention &&
          "border-burned-orange/45 bg-burned-orange/[0.07] text-navy-blue",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{label({}, { locale })}</p>
          <p className="mt-1 text-xs leading-5">
            {current
              ? getAdministrationLifecycleConditionLabel(
                  lifecycle.condition,
                  locale
                )
              : note({}, { locale })}
          </p>
        </div>
        {reached && !current && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-navy-blue/8">
            <Check aria-hidden className="size-3" />
            <span className="sr-only">
              {m.administrationReservationLifecycleStageReached({}, { locale })}
            </span>
          </span>
        )}
        {current && (
          <span
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full",
              attention
                ? "bg-burned-orange text-white"
                : "bg-aquamarine-ink text-white"
            )}
          >
            {attention ? (
              <CircleAlert aria-hidden className="size-3" />
            ) : (
              <span aria-hidden className="size-1.5 rounded-full bg-white" />
            )}
            <span className="sr-only">
              {m.administrationReservationLifecycleStageCurrent({}, { locale })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
