import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/shared/utils";

type ContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean;
};

export function Container({ className, asChild, ...props }: ContainerProps) {
  const Component = asChild ? Slot : "div";
  return (
    <Component
      className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}
      {...props}
    />
  );
}
