import { cva } from "class-variance-authority";

/**
 * Class names for a button that opens a picker for a form field, such as a
 * select or date trigger. It matches `Input`, so pickers and text fields line
 * up in one form. Mark an empty field with `data-placeholder`.
 */
const fieldTriggerVariants = cva(
  "flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-[1.1rem] border bg-white px-4 py-3 text-left text-base text-navy-blue outline-none transition data-[placeholder]:text-navy-blue/55 focus-visible:ring-2 focus-visible:ring-burned-orange disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-navy-blue/45 focus-visible:border-burned-orange",
        error: "border-burned-orange focus-visible:border-burned-orange",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export { fieldTriggerVariants };
