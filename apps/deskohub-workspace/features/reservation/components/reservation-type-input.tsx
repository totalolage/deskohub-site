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
type ReservationTypePresentation = "illustrated";

type ReservationTypeInputContextValue = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaRequired?: boolean;
  readonly idPrefix: string;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange: (value: ReservationTypeValue) => void;
  readonly presentation?: ReservationTypePresentation;
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
  readonly presentation?: ReservationTypePresentation;
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
  presentation,
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
      presentation,
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
      presentation,
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
          data-reservation-type-presentation={presentation}
          className={cn(
            presentation === "illustrated"
              ? "grid gap-4 lg:grid-cols-2"
              : "grid space-y-3 lg:grid-cols-3 lg:grid-rows-[repeat(4,auto)] lg:space-y-0 lg:gap-x-3",
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

  const isIllustrated = input.presentation === "illustrated";
  const inputId = `${input.idPrefix}-${value}`;
  const priceId = `${inputId}-price`;
  const titleId = `${inputId}-title`;
  const isSelected = input.value === value;
  return (
    <label
      htmlFor={inputId}
      data-reservation-type-option={value}
      className={cn(
        "group grid cursor-pointer outline -outline-offset-1 outline-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-28px_rgba(0,2,79,0.7)]",
        isIllustrated
          ? "relative isolate grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 overflow-hidden rounded-[1.4rem] px-4 py-5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-burned-orange sm:px-6 sm:py-6 lg:grid-rows-[auto_auto_1fr_auto]"
          : "rounded-[1.4rem] px-4 lg:grid-rows-subgrid lg:row-span-4",
        disabled &&
          "cursor-not-allowed opacity-45 hover:translate-y-0 hover:shadow-none",
        isSelected &&
          "bg-burned-orange/8 outline-burned-orange ring-4 ring-burned-orange/10",
        !isSelected && "bg-white outline-navy-blue/10",
        !isSelected && "hover:outline-burned-orange/45",
        className
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
      <span
        id={titleId}
        className={cn(
          "mt-4 mb-3 flex items-start justify-between gap-2",
          isIllustrated && "relative z-10 col-span-2 mt-0 mb-2"
        )}
        data-reservation-type-title={value}
      >
        <span
          className={cn(
            "text-lg leading-6",
            isIllustrated &&
              "min-w-0 flex-1 break-words text-2xl font-semibold leading-8 sm:text-3xl sm:leading-9"
          )}
        >
          {title}
        </span>
        <span
          data-reservation-type-radio-visual={value}
          className={cn(
            "mt-1 h-4 w-4 shrink-0 rounded-full border transition",
            isIllustrated && "mt-1 h-6 w-6 border-2 sm:h-7 sm:w-7",
            isSelected
              ? "border-burned-orange bg-burned-orange shadow-[inset_0_0_0_4px_white]"
              : "border-navy-blue/25"
          )}
        />
      </span>
      <div
        className={cn(
          "mb-3 flex items-start gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-navy-blue",
          isIllustrated &&
            "relative z-10 col-span-2 mb-2 min-w-0 break-words text-[2rem] normal-case leading-9 tracking-normal sm:mb-3 sm:text-4xl sm:leading-10 max-[240px]:text-lg max-[240px]:leading-6"
        )}
        data-reservation-type-price-row={value}
      >
        <span
          id={priceId}
          className={cn(
            "flex flex-col items-start gap-0.5",
            isIllustrated && "min-w-0 gap-0 break-words"
          )}
          data-reservation-type-price={value}
          data-reservation-type-price-ready={priceReady}
        >
          {price}
        </span>
      </div>
      {children}
    </label>
  );
}
