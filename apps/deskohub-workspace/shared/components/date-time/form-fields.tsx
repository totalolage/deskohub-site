"use client";

import { useFormField } from "@/shared/components/ui/form";
import { DateInput, type DateInputProps } from "./date-input";
import { DateTimeInput, type DateTimeInputProps } from "./date-time-input";
import { TimeInput, type TimeInputProps } from "./time-input";

/**
 * The date, time, and date-time controls inside a React Hook Form
 * `FormItem`, in place of `FormControl`: the item's label names the control
 * (the date field of a date-time), and its message describes it and marks
 * it invalid while the field has an error. Pass the field's `name`, `value`,
 * `onChange`, `onBlur`, and `ref`.
 */
const useFormFieldWiring = (ariaDescribedBy: string | undefined) => {
  const { error, formItemId, formLabelId, formMessageId } = useFormField();
  return {
    "aria-describedby":
      [ariaDescribedBy, error ? formMessageId : undefined]
        .filter(Boolean)
        .join(" ") || undefined,
    "aria-invalid": Boolean(error),
    "aria-labelledby": formLabelId,
    id: formItemId,
  };
};

export function FormDateInput(props: DateInputProps) {
  const wiring = useFormFieldWiring(props["aria-describedby"]);
  return <DateInput {...props} {...wiring} />;
}

export function FormTimeInput(props: TimeInputProps) {
  const wiring = useFormFieldWiring(props["aria-describedby"]);
  return <TimeInput {...props} {...wiring} />;
}

export function FormDateTimeInput(props: DateTimeInputProps) {
  const wiring = useFormFieldWiring(props["aria-describedby"]);
  return <DateTimeInput {...props} {...wiring} />;
}
