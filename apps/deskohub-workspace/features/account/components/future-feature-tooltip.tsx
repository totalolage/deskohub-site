"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
} from "react";
import { type Locale, m } from "@/features/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

type FutureFeatureTooltipProps = {
  readonly children: ReactNode;
  readonly locale: Locale;
};

export function FutureFeatureTooltip({
  children,
  locale,
}: FutureFeatureTooltipProps) {
  const message = m.account_future_feature_tooltip({}, { locale });
  const contentId = useId();
  const childNodes = Children.toArray(children);
  const child = childNodes.length === 1 ? childNodes[0] : undefined;
  const elementChild = isValidElement<{ readonly id?: string }>(child)
    ? child
    : undefined;
  const existingChildId = elementChild?.props.id;
  const childId = existingChildId || contentId;
  const labelledChild =
    elementChild && !existingChildId
      ? cloneElement(elementChild, { id: contentId })
      : child;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        {/* biome-ignore-start lint/a11y/noNoninteractiveTabindex: The non-button group must be keyboard-focusable to expose a tooltip for a disabled child. */}
        {/* biome-ignore-start lint/a11y/useSemanticElements: A span preserves inline placement around disabled account controls. */}
        <TooltipTrigger asChild>
          <span
            aria-labelledby={childId}
            className="inline-flex min-w-0 max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
            role="group"
            tabIndex={0}
          >
            <span className="pointer-events-none contents">
              {labelledChild ?? children}
            </span>
          </span>
        </TooltipTrigger>
        {/* biome-ignore-end lint/a11y/useSemanticElements: A span preserves inline placement around disabled account controls. */}
        {/* biome-ignore-end lint/a11y/noNoninteractiveTabindex: The non-button group must be keyboard-focusable to expose a tooltip for a disabled child. */}
        <TooltipContent
          collisionPadding={16}
          className="w-[min(20rem,calc(100vw-2rem))] max-w-[320px] break-words whitespace-normal"
        >
          {message}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
