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
  return (
    <div className="rounded-xl border border-navy-blue/10 bg-white p-4 sm:p-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        {lifecycleStages.map((item, index) => (
          <div className="contents" key={item.stage}>
            <LifecycleStageCard lifecycle={lifecycle} {...item} />
            {index < lifecycleStages.length - 1 && (
              <ArrowRight
                aria-hidden
                className={cn(
                  "mx-auto hidden size-4 md:block",
                  lifecycle.reachedStages.includes(
                    lifecycleStages[index + 1]?.stage ?? "started"
                  )
                    ? "text-navy-blue/55"
                    : "text-navy-blue/18"
                )}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="md:col-start-3">
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
      </div>
    </div>
  );
}

function LifecycleStageCard({
  label,
  lifecycle,
  note,
  stage,
}: {
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
          "border-burned-orange/45 bg-burned-orange/[0.07] text-navy-blue"
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
