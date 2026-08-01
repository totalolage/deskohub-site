"use client";

import { Percent } from "lucide-react";
import { useInView, useReducedMotion } from "motion/react";
import {
  createContext,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { cn } from "@/shared/utils";

type ReservationTypeValue = string;

type ReservationTypeInputContextValue = {
  readonly idPrefix: string;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange: (value: ReservationTypeValue) => void;
  readonly shouldAnimateSaleGlimmer: boolean;
  readonly value: ReservationTypeValue;
};

type ReservationTypeInputProps<Value extends ReservationTypeValue> = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> & {
  readonly idPrefix?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange: (value: Value) => void;
  readonly ref?: Ref<HTMLDivElement>;
  readonly value: Value;
};

export type ReservationTypeOptionDiscount = {
  readonly details?: ReactNode;
  readonly labels: ReadonlyArray<{
    readonly id: Key;
    readonly label: ReactNode;
  }>;
};

type ReservationTypeOptionProps<Value extends ReservationTypeValue> = {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly discount?: ReservationTypeOptionDiscount;
  readonly price: ReactNode;
  readonly priceReady?: boolean;
  readonly title: ReactNode;
  readonly value: Value;
};

const ReservationTypeInputContext =
  createContext<ReservationTypeInputContextValue | null>(null);
const ReservationTypeInputRefContext = createContext<
  Ref<HTMLInputElement> | undefined
>(undefined);

const setRef = <Value,>(ref: Ref<Value> | undefined, value: Value | null) => {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
};

export function ReservationTypeInput<Value extends ReservationTypeValue>({
  children,
  className,
  idPrefix = "reservation-type",
  inputRef,
  name,
  onBlur,
  onChange,
  ref,
  value,
  ...props
}: ReservationTypeInputProps<Value>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isVisible = useInView(rootRef, { amount: 0.15 });
  const shouldReduceMotion = useReducedMotion();
  const composedRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      setRef(ref, node);
    },
    [ref]
  );
  const context = useMemo<ReservationTypeInputContextValue>(
    () => ({
      idPrefix,
      name,
      onBlur,
      onChange: (nextValue) => onChange(nextValue as Value),
      shouldAnimateSaleGlimmer: isVisible && !shouldReduceMotion,
      value,
    }),
    [idPrefix, isVisible, name, onBlur, onChange, shouldReduceMotion, value]
  );

  return (
    <ReservationTypeInputRefContext.Provider value={inputRef}>
      <ReservationTypeInputContext.Provider value={context}>
        <div
          ref={composedRef}
          className={cn(
            "grid space-y-3 lg:grid-cols-3 lg:grid-rows-[repeat(5,auto)] lg:space-y-0 lg:gap-x-3",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </ReservationTypeInputContext.Provider>
    </ReservationTypeInputRefContext.Provider>
  );
}

export function ReservationTypeOption<Value extends ReservationTypeValue>({
  children,
  className,
  disabled = false,
  discount,
  price,
  priceReady = true,
  title,
  value,
}: ReservationTypeOptionProps<Value>) {
  const input = useContext(ReservationTypeInputContext);
  const inputRef = useContext(ReservationTypeInputRefContext);

  if (!input) {
    throw new Error(
      "ReservationTypeOption must be used within ReservationTypeInput"
    );
  }

  const inputId = `${input.idPrefix}-${value}`;
  const isSelected = input.value === value;
  const hasDiscount = Boolean(discount?.labels.length);

  return (
    <div
      data-reservation-type-option={value}
      className={cn(
        "group relative grid cursor-pointer rounded-[1.4rem] px-4 outline -outline-offset-1 outline-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-28px_rgba(0,2,79,0.7)] lg:grid-rows-subgrid",
        hasDiscount
          ? "lg:row-start-1 lg:row-span-5"
          : "lg:row-start-2 lg:row-span-4",
        disabled &&
          "cursor-not-allowed opacity-45 hover:translate-y-0 hover:shadow-none",
        isSelected &&
          hasDiscount &&
          "bg-purple-500/5 outline-purple-500 ring-4 ring-purple-500/10",
        isSelected &&
          !hasDiscount &&
          "bg-burned-orange/8 outline-burned-orange ring-4 ring-burned-orange/10",
        !isSelected && "bg-white outline-navy-blue/10",
        !isSelected && hasDiscount && "hover:outline-purple-500/60",
        !isSelected && !hasDiscount && "hover:outline-burned-orange/45",
        className
      )}
    >
      {hasDiscount && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] border-2 border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
          data-reservation-type-sale-glimmer={value}
          style={{
            opacity: input.shouldAnimateSaleGlimmer ? 1 : 0,
          }}
        >
          <span
            data-reservation-type-sale-glimmer-beam=""
            className={cn(
              "absolute aspect-square motion-reduce:animate-none",
              input.shouldAnimateSaleGlimmer && "animate-tier-sale-glimmer"
            )}
            style={{
              backgroundImage:
                "linear-gradient(to right, transparent 0%, var(--color-purple-300) 50%, transparent 100%)",
              offsetPath: "rect(0 auto auto 0 round 1.4rem)",
              width: "5rem",
            }}
          />
        </span>
      )}
      {hasDiscount && discount && (
        <div
          className="pointer-events-none relative z-20 -mx-4 flex items-center gap-2 rounded-t-[1.3rem] border-b border-purple-300/60 bg-purple-100 px-4 py-2.5 text-sm font-semibold leading-5 text-purple-900"
          data-reservation-type-discount-banner={value}
        >
          <Percent aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex flex-wrap gap-x-2 gap-y-0.5">
            {discount.labels.map(({ id, label }) => (
              <span key={id} data-reservation-type-discount={id}>
                {label}
              </span>
            ))}
          </span>
        </div>
      )}
      <label
        htmlFor={inputId}
        className={cn(
          "relative z-10 mt-4 mb-3 flex cursor-pointer items-start justify-between gap-2",
          disabled && "cursor-not-allowed"
        )}
        data-reservation-type-title={value}
      >
        <span className="text-lg leading-6">{title}</span>
        <span
          data-reservation-type-radio-visual={value}
          className={cn(
            "mt-1 h-4 w-4 shrink-0 rounded-full border transition",
            isSelected
              ? "border-burned-orange bg-burned-orange shadow-[inset_0_0_0_4px_white]"
              : "border-navy-blue/25"
          )}
        />
      </label>
      <div
        className="relative z-20 mb-3 flex items-start gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-navy-blue"
        data-reservation-type-price-row={value}
      >
        <label
          className={cn(
            "flex cursor-pointer flex-col items-start gap-0.5",
            disabled && "cursor-not-allowed"
          )}
          data-reservation-type-price={value}
          data-reservation-type-price-ready={priceReady}
          htmlFor={inputId}
        >
          {price}
        </label>
        {hasDiscount && discount?.details}
      </div>
      {children}
      <label
        htmlFor={inputId}
        className={cn(
          "absolute inset-0 cursor-pointer rounded-[1.4rem]",
          disabled && "cursor-not-allowed"
        )}
      >
        <input
          id={inputId}
          name={input.name}
          type="radio"
          className="sr-only"
          checked={isSelected}
          value={value}
          disabled={disabled}
          onChange={() => {
            if (!disabled) {
              input.onChange(value);
            }
          }}
          onBlur={input.onBlur}
          ref={inputRef}
        />
      </label>
    </div>
  );
}
