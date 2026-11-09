import { Button } from "@/shared/components/ui/button";

export function SkipLink({ label }: { label: string }) {
  return (
    <Button
      asChild
      className="fixed -top-24 left-4 z-[100] focus:top-4"
      variant="secondary"
    >
      <a href="#main-content">{label}</a>
    </Button>
  );
}
