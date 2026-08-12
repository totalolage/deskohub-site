"use client";

import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  useContext,
  useMemo,
} from "react";
import { cn } from "@/shared/utils";

type ReservationTypeValue = string;

type ReservationTypeInputContextValue = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaRequired?: boolean;
  readonly idPrefix: string;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange: (value: ReservationTypeValue) => void;
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

type ReservationTypeOptionProps<Value extends ReservationTypeValue> = {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
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
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
  ...props
}: ReservationTypeInputProps<Value>) {
  const context = useMemo<ReservationTypeInputContextValue>(
    () => ({
      idPrefix,
      ariaDescribedBy,
      ariaInvalid: ariaInvalid === true || ariaInvalid === "true",
      ariaRequired: ariaRequired === true || ariaRequired === "true",
      name,
      onBlur,
      onChange: (nextValue) => onChange(nextValue as Value),
      value,
    }),
    [
      ariaDescribedBy,
      ariaInvalid,
      ariaRequired,
      idPrefix,
      name,
      onBlur,
      onChange,
      value,
    ]
  );

  return (
    <ReservationTypeInputRefContext.Provider value={inputRef}>
      <ReservationTypeInputContext.Provider value={context}>
        <div
          ref={ref}
          role="radiogroup"
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          className={cn(
            "grid space-y-3 lg:grid-cols-3 lg:grid-rows-[repeat(4,auto)] lg:space-y-0 lg:gap-x-3",
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
  const priceId = `${inputId}-price`;
  const titleId = `${inputId}-title`;
  const isSelected = input.value === value;
  return (
    <div
      data-reservation-type-option={value}
      className={cn(
        "group relative grid cursor-pointer rounded-[1.4rem] px-4 outline -outline-offset-1 outline-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-28px_rgba(0,2,79,0.7)] lg:grid-rows-subgrid",
        "lg:row-span-4",
        disabled &&
          "cursor-not-allowed opacity-45 hover:translate-y-0 hover:shadow-none",
        isSelected &&
          "bg-burned-orange/8 outline-burned-orange ring-4 ring-burned-orange/10",
        !isSelected && "bg-white outline-navy-blue/10",
        !isSelected && "hover:outline-burned-orange/45",
        className
      )}
    >
      <span
        id={titleId}
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
      </span>
      <div
        className="relative z-20 mb-3 flex items-start gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-navy-blue"
        data-reservation-type-price-row={value}
      >
        <span
          id={priceId}
          className={cn(
            "flex cursor-pointer flex-col items-start gap-0.5",
            disabled && "cursor-not-allowed"
          )}
          data-reservation-type-price={value}
          data-reservation-type-price-ready={priceReady}
        >
          {price}
        </span>
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
          aria-describedby={input.ariaDescribedBy}
          aria-invalid={input.ariaInvalid}
          aria-labelledby={`${titleId} ${priceId}`}
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
