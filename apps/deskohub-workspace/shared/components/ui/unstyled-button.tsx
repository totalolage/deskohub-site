import type * as React from "react";
import { cn } from "@/shared/utils";

type UnstyledButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly ref?: React.Ref<HTMLButtonElement>;
};

/**
 * A button with no visual treatment, for hit areas whose look comes from
 * their content, such as carousel dots or image tiles that open a lightbox.
 * Defaults to `type="button"` and keeps a visible focus outline; style the
 * rest through `className`. Use `Button` for anything that reads as an action.
 */
function UnstyledButton({
  className,
  type = "button",
  ...props
}: UnstyledButtonProps) {
  return (
    <button
      className={cn(
        "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burned-orange disabled:cursor-not-allowed",
        className
      )}
      type={type}
      {...props}
    />
  );
}

export { UnstyledButton };
