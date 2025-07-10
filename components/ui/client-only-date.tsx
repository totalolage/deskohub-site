"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/i18n";
import { formatDate, formatTime } from "@/lib/utils/date-formatting";

interface ClientOnlyDateProps {
  date?: Date | string;
  locale: Locale;
  showTime?: boolean;
  showDate?: boolean;
  updateInterval?: number;
  className?: string;
}

/**
 * Component for rendering dates/times that should only render on the client
 * This prevents hydration mismatches for dynamic dates
 */
export function ClientOnlyDate({
  date = new Date(),
  locale,
  showTime = true,
  showDate = false,
  updateInterval,
  className,
}: ClientOnlyDateProps) {
  const [mounted, setMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState(date);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!updateInterval) return;

    const interval = setInterval(() => {
      setCurrentDate(new Date());
    }, updateInterval);

    return () => clearInterval(interval);
  }, [updateInterval]);

  if (!mounted) {
    // Return a placeholder with the same structure to avoid layout shift
    return <span className={className}>--:--</span>;
  }

  const formattedDate = showDate ? formatDate(currentDate, locale) : "";
  const formattedTime = showTime ? formatTime(currentDate, locale) : "";
  const separator = showDate && showTime ? " " : "";

  return (
    <span className={className} suppressHydrationWarning>
      {formattedDate}
      {separator}
      {formattedTime}
    </span>
  );
}
