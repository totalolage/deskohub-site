import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/utils";

const textareaVariants = cva(
  "flex min-h-32 w-full rounded-[1.1rem] border bg-white px-4 py-3 text-base text-navy-blue outline-none transition placeholder:text-navy-blue/38 focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-navy-blue/12 focus-visible:border-burned-orange focus-visible:ring-burned-orange/10",
        error:
          "border-burned-orange focus-visible:border-burned-orange focus-visible:ring-burned-orange/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface TextareaProps
  extends React.ComponentProps<"textarea">,
    VariantProps<typeof textareaVariants> {
  ref?: React.Ref<HTMLTextAreaElement>;
}

function Textarea({ className, variant, ref, ...props }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={cn(textareaVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Textarea };
