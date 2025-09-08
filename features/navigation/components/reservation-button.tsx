"use client";

import { Calendar } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { siteConstants } from "@/shared/utils/constants";

interface ReservationButtonProps {
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  showIcon?: boolean;
  onClick?: () => void;
  variant?: "default" | "full";
}

export function ReservationButton({
  size = "default",
  className = "",
  showIcon = false,
  onClick,
  variant = "default",
}: ReservationButtonProps) {
  // Don't render if reservations are disabled
  if (!siteConstants.featureFlags.tableReservations) {
    return null;
  }

  const buttonClasses =
    variant === "full"
      ? `w-full bg-green-500 hover:bg-green-600 text-white font-semibold ${className}`
      : `bg-green-500 hover:bg-green-600 text-white ${className}`;

  return (
    <Link href="/reservation">
      <Button size={size} className={buttonClasses} onClick={onClick}>
        {showIcon && <Calendar className="h-4 w-4 mr-2" />}
        {m["buttons.reservation"]()}
      </Button>
    </Link>
  );
}
