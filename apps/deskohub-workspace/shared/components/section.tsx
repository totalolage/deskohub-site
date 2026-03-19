import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/shared/utils";
import { Container } from "./container";

type SectionProps = React.HTMLAttributes<HTMLElement> & {
  containerClassName?: string;
  asChild?: boolean;
};

export function Section({
  className,
  containerClassName,
  children,
  asChild,
  ...props
}: SectionProps) {
  const Component = asChild ? Slot : "section";
  return (
    <Component className={cn("py-12 sm:py-16", className)} {...props}>
      <Container className={containerClassName} asChild={asChild}>{children}</Container>
    </Component>
  );
}
