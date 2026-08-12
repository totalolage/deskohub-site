import { cn } from "@/shared/utils";

export function SkipLink({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <a
      href="#main-content"
      className={cn(
        "fixed left-4 top-4 z-[100] -translate-y-24 rounded-full bg-white px-5 py-3 font-semibold text-navy-blue shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-burned-orange focus:ring-offset-2 motion-reduce:transition-none",
        className
      )}
    >
      {label}
    </a>
  );
}
