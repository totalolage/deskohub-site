import { ArrowDown, ArrowRight, Check, CircleAlert } from "lucide-react";
import { cn } from "@/shared/utils";
import type {
  AdministrationLifecycleStage,
  AdministrationReservationLifecycle,
} from "./reservation-status";

const lifecycleStages = [
  { stage: "started", label: "Started", note: "Checkout workflow created" },
  { stage: "held", label: "Held", note: "Reservation is held" },
  { stage: "paid", label: "Paid", note: "Payment was recorded" },
  { stage: "complete", label: "Complete", note: "Access was delivered" },
] as const;

type CancellationLifecycleStage = Extract<
  AdministrationLifecycleStage,
  "hold_expired" | "cancelling" | "cancellation_failed" | "cancelled"
>;

const cancellationStagePresentation: Record<
  CancellationLifecycleStage,
  { readonly label: string; readonly note: string }
> = {
  hold_expired: {
    label: "Hold expired",
    note: "Waiting for the held booking to be released",
  },
  cancelling: {
    label: "Cancelling",
    note: "The held booking is being released",
  },
  cancellation_failed: {
    label: "Cancellation issue",
    note: "The held booking still needs attention",
  },
  cancelled: { label: "Cancelled", note: "The hold was released" },
};

const isCancellationStage = (
  stage: AdministrationLifecycleStage
): stage is CancellationLifecycleStage =>
  stage in cancellationStagePresentation;

export function ReservationLifecycleMap({
  lifecycle,
}: {
  readonly lifecycle: AdministrationReservationLifecycle;
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
          {...started}
        />
        <LifecycleConnector
          className="md:col-start-2 md:row-start-1"
          reached={lifecycle.reachedStages.includes("held")}
        />
        <LifecycleStageCard
          className="md:col-start-3 md:row-start-1"
          lifecycle={lifecycle}
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
            note={cancellation.note}
            stage={cancellationStage}
          />
        </div>

        <LifecycleConnector
          className="md:col-start-4 md:row-start-1"
          mobileLabel="Or continue to payment"
          reached={lifecycle.reachedStages.includes("paid")}
        />
        <LifecycleStageCard
          className="md:col-start-5 md:row-start-1"
          lifecycle={lifecycle}
          {...paid}
        />
        <LifecycleConnector
          className="md:col-start-6 md:row-start-1"
          reached={lifecycle.reachedStages.includes("complete")}
        />
        <LifecycleStageCard
          className="md:col-start-7 md:row-start-1"
          lifecycle={lifecycle}
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
  note,
  stage,
}: {
  readonly className?: string;
  readonly label: string;
  readonly lifecycle: AdministrationReservationLifecycle;
  readonly note: string;
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
          <p className="text-sm font-semibold">{label}</p>
          <p className="mt-1 text-xs leading-5">
            {current ? lifecycle.label : note}
          </p>
        </div>
        {reached && !current && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-navy-blue/8">
            <Check aria-hidden className="size-3" />
            <span className="sr-only">Reached</span>
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
            <span className="sr-only">Current stage</span>
          </span>
        )}
      </div>
    </div>
  );
}
