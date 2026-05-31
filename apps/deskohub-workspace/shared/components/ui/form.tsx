"use client";

import type * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
} from "react-hook-form";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils";

const Form = FormProvider;

const FormFieldContext = React.createContext<{ name: string } | null>(null);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => (
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
    formDescriptionId: `${itemContext.id}-form-item-description`,
    formMessageId: `${itemContext.id}-form-item-message`,
    ...fieldState,
  };
}

function FormItem({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        ref={ref}
        className={cn("flex flex-col gap-y-2", className)}
        {...props}
      />
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
  const { error, formItemId } = useFormField();

  return (
    <Label
      ref={ref}
      className={cn(
        error && "text-burned-orange",
        required && "after:content-['_*']",
        className
      )}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Slot> & {
  ref?: React.Ref<React.ComponentRef<typeof Slot>>;
}) {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();

  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={
        error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId
      }
      aria-invalid={Boolean(error)}
      {...props}
    />
  );
}

function FormDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.Ref<HTMLParagraphElement>;
}) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn("text-sm text-navy-blue/62", className)}
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

  if (!body) {
    return null;
  }

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn("text-sm font-medium text-burned-orange", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
