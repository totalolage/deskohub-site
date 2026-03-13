import type * as React from "react";
import { cn } from "@/shared/utils";
import { Container } from "./container";

type SectionProps = React.HTMLAttributes<HTMLElement> & {
  containerClassName?: string;
};

export function Section({
  className,
  containerClassName,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={cn("py-12 sm:py-16", className)} {...props}>
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}
