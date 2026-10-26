import { CircleAlert, CircleCheck } from "lucide-react";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

export function EmailVerificationStatus({
  emailVerified,
  locale,
}: {
  readonly emailVerified: boolean;
  readonly locale: Locale;
}) {
  const status = (
    {
      verified: {
        tone: "success",
        label: m.accountProfileEmailVerificationVerified,
        Icon: CircleCheck,
      },
      unverified: {
        tone: "warning",
        label: m.accountProfileEmailVerificationUnverified,
        Icon: CircleAlert,
      },
    } as const
  )[emailVerified ? "verified" : "unverified"];
  const Icon = status.Icon;
  const label = status.label({}, { locale });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            className="shrink-0"
            size="icon-sm"
            tone={status.tone}
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          collisionPadding={16}
          className="w-[min(22rem,calc(100vw-2rem))] break-words whitespace-normal"
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
