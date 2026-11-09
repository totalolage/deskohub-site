"use client";

import type * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider as Form,
  useFormContext,
} from "react-hook-form";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils";

const FormFieldContext = React.createContext<{ name: string } | null>(null);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues,
>({
  ...props
}: ControllerProps<TFieldValues, TName, TTransformedValues>) => (
  <FormFieldContext.Provider value={{ name: props.name }}>
    <Controller {...props} />
  </FormFieldContext.Provider>
);

const FormItemContext = React.createContext<{ id: string } | null>(null);

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  if (!itemContext) {
    throw new Error("useFormField should be used within <FormItem>");
  }

  const fieldState = getFieldState(fieldContext.name, formState);

  return {
    id: itemContext.id,
    name: fieldContext.name,
    formItemId: `${itemContext.id}-form-item`,
    formLabelId: `${itemContext.id}-form-item-label`,
    formMessageId: `${itemContext.id}-form-item-message`,
    ...fieldState,
  };
}

/**
 * The label, control, and message stack every `FormItem` renders. Use it
 * directly when the item itself stays out of layout (`className="contents"`)
 * so its label still sits at the same distance from its control.
 */
function FormItemLayout({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-y-2", className)}
      {...props}
    />
  );
}

function FormItem({
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <FormItemLayout ref={ref} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  required,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
  required?: boolean;
  ref?: React.Ref<React.ComponentRef<typeof LabelPrimitive.Root>>;
}) {
  const { error, formItemId, formLabelId } = useFormField();

  return (
    <Label
      ref={ref}
      className={cn(
        error && "text-burned-orange",
        required && "after:content-['_*']",
        className
      )}
      htmlFor={formItemId}
      id={formLabelId}
      {...props}
    />
  );
}

function FormControl({
  ref,
  "aria-describedby": describedBy,
  ...props
}: React.ComponentPropsWithoutRef<typeof Slot> & {
  ref?: React.Ref<React.ComponentRef<typeof Slot>>;
}) {
  const { error, formItemId, formLabelId, formMessageId } = useFormField();

  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={
        [describedBy, error && formMessageId].filter(Boolean).join(" ") ||
        undefined
      }
      aria-invalid={Boolean(error)}
      aria-labelledby={formLabelId}
      {...props}
    />
  );
}

function FormMessage({
  className,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.Ref<HTMLParagraphElement>;
}) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message) : children;

  // The live region stays mounted so screen readers announce the message when
  // it appears; while empty it leaves the item's flow and gap.
  return (
    <p
      ref={ref}
      id={formMessageId}
      aria-live="polite"
      className={cn(
        "text-sm font-medium text-burned-orange empty:sr-only",
        className
      )}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormItemLayout,
  FormLabel,
  FormMessage,
  useFormField,
};
