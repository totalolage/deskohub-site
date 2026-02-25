import { useSafeArea } from "@/shared/providers/safe-area-provider";
import { cn } from "@/shared/utils";

export function useSafeAreaClasses() {
  const insets = useSafeArea();

  return {
    top: (className?: string) =>
      cn(insets.top > 0 ? "safe-padding-top" : "", className),
    right: (className?: string) =>
      cn(insets.right > 0 ? "safe-padding-right" : "", className),
    bottom: (className?: string) =>
      cn(insets.bottom > 0 ? "safe-padding-bottom" : "", className),
    left: (className?: string) =>
      cn(insets.left > 0 ? "safe-padding-left" : "", className),
    horizontal: (className?: string) =>
      cn(
        insets.left > 0 || insets.right > 0 ? "safe-padding-horizontal" : "",
        className
      ),
    vertical: (className?: string) =>
      cn(
        insets.top > 0 || insets.bottom > 0 ? "safe-padding-vertical" : "",
        className
      ),
    all: (className?: string) =>
      cn(
        insets.top > 0 ||
          insets.right > 0 ||
          insets.bottom > 0 ||
          insets.left > 0
          ? "safe-padding"
          : "",
        className
      ),
  };
}
