"use client";

import type { CalendarExpressionType as CalendarExpression } from "@deskohub/workspace-admin-api";
import { useState } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { useCampaignOperation } from "../../use-campaign-operation";
import {
  type CalendarPreviewView,
  type CalendarUsage,
  calendarPreviewFailureCopy,
  calendarPreviewView,
} from "./calendar-preview";

/**
 * The port's preview of a calendar being edited. It starts from the page
 * load's preview and asks `previewCalendarExpression` again after each edit;
 * only the answer for the latest edit is shown, because the operation reports
 * back for its latest call only.
 */
export function useCalendarPreview(
  initial: CalendarPreviewView | undefined,
  usage: CalendarUsage
) {
  const locale = useRouteLocale();
  const [preview, setPreview] = useState(initial);
  const operation = useCampaignOperation("previewCalendarExpression", {
    failureCopy: calendarPreviewFailureCopy,
    onSuccess: (output) => setPreview(calendarPreviewView(output, locale)),
    onFailure: (message, failure) =>
      setPreview({ _tag: "Failed", message, code: failure?.code }),
  });
  return {
    preview,
    pending: operation.isExecuting,
    refresh: (expression: CalendarExpression) =>
      operation.execute({ expression, usage, locale }),
  };
}
