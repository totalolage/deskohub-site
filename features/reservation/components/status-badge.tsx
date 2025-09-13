import { cva } from "class-variance-authority";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import { m } from "@/features/i18n";
import type { ReservationStatus } from "./reservation-confirmation";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full",
  {
    variants: {
      status: {
        submitted: "bg-blue-100 text-blue-700 border-blue-200",
        confirmed: "bg-green-100 text-green-700 border-green-200",
        rejected: "bg-red-100 text-red-700 border-red-200",
      },
    },
  }
);

interface ReservationStatusBadgeProps {
  status: ReservationStatus;
}

export function ReservationStatusBadge({
  status,
}: ReservationStatusBadgeProps) {
  const getStatusIcon = () => {
    switch (status) {
      case "confirmed":
        return <CheckCircle className="w-4 h-4" />;
      case "rejected":
        return <XCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "confirmed":
        return m["status.confirmed"]();
      case "rejected":
        return m["status.rejected"]();
      default:
        return m["status.pending"]();
    }
  };

  return (
    <div className={statusBadgeVariants({ status })}>
      {getStatusIcon()}
      <span>{getStatusLabel()}</span>
    </div>
  );
}
