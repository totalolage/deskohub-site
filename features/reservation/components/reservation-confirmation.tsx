"use client";

import { cva } from "class-variance-authority";
import { Calendar, Clock, Mail, Phone, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { m } from "@/features/i18n/paraglide/messages";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Separator } from "@/shared/components/ui/separator";
import { cn } from "@/shared/utils";
import { siteConstants } from "@/shared/utils/constants";
import {
  formatDate,
  formatDurationMinutes,
} from "@/shared/utils/date-formatting";
import { formatPhoneNumber } from "@/shared/utils/phone-formatting";
import { ReservationStatusBadge } from "./status-badge";

// CVA variants for status-based styling
const statusIconWrapperVariants = cva(
  "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4",
  {
    variants: {
      status: {
        submitted: "bg-blue-100",
        confirmed: "bg-green-100",
        rejected: "bg-red-100",
      },
    },
  }
);

const statusIconVariants = cva("w-8 h-8", {
  variants: {
    status: {
      submitted: "text-blue-600",
      confirmed: "text-green-600",
      rejected: "text-red-600",
    },
  },
});

const statusTitleVariants = cva("text-3xl font-bold mb-2", {
  variants: {
    status: {
      submitted: "text-blue-800",
      confirmed: "text-green-800",
      rejected: "text-red-800",
    },
  },
});

const statusCardTitleVariants = cva("", {
  variants: {
    status: {
      submitted: "text-blue-800",
      confirmed: "text-green-800",
      rejected: "text-red-800",
    },
  },
});

const statusCardVariants = cva("mb-8", {
  variants: {
    status: {
      submitted: "bg-blue-50 border-blue-200",
      confirmed: "bg-green-50 border-green-200",
      rejected: "bg-red-50 border-red-200",
    },
  },
});

const statusTextVariants = cva("", {
  variants: {
    status: {
      submitted: "text-blue-700",
      confirmed: "text-green-700",
      rejected: "text-red-700",
    },
  },
});

const statusIconSmallVariants = cva("w-5 h-5", {
  variants: {
    status: {
      submitted: "text-blue-600",
      confirmed: "text-green-600",
      rejected: "text-red-600",
    },
  },
});

const statusAccentTextVariants = cva("", {
  variants: {
    status: {
      submitted: "text-blue-600",
      confirmed: "text-green-600",
      rejected: "text-red-600",
    },
  },
});

const statusButtonVariants = cva("", {
  variants: {
    status: {
      submitted: "bg-blue-600 hover:bg-blue-700",
      confirmed: "bg-green-600 hover:bg-green-700",
      rejected: "bg-red-600 hover:bg-red-700",
    },
  },
});

export type ReservationStatus = "submitted" | "confirmed" | "rejected";

// Status Icon Component
interface StatusIconProps {
  status: ReservationStatus;
}

function StatusIcon({ status }: StatusIconProps) {
  switch (status) {
    case "confirmed":
      return (
        <svg
          className={statusIconVariants({ status })}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          role="img"
          aria-label="Confirmed"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      );
    case "rejected":
      return (
        <svg
          className={statusIconVariants({ status })}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          role="img"
          aria-label="Rejected"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      );
    default:
      return (
        <svg
          className={statusIconVariants({ status })}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          role="img"
          aria-label="Pending"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
  }
}

export interface ReservationDetails {
  id?: string;
  name: string;
  email: string | undefined;
  phone: string | undefined;
  date: Date;
  time: string;
  durationMinutes?: number;
  guestCount?: number;
  specialRequests?: string;
  tablePreference?: "standard" | "large" | "private";
}

interface ReservationConfirmationProps {
  status: ReservationStatus;
  type: "table" | "training-room";
  details: ReservationDetails;
  customMessage?: ReactNode;
}

export function ReservationConfirmation({
  status,
  type,
  details,
  customMessage,
}: ReservationConfirmationProps) {
  const locale = useLocale();

  const formattedDate = formatDate(details.date, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = details.time;

  const getStatusTitle = () => {
    if (type === "training-room" && status === "submitted") {
      return m["trainingReservation.confirmation.title"]();
    }

    switch (status) {
      case "confirmed":
        return m["thankYou.title"](); // "Reservation Confirmed!"
      case "rejected":
        return m["reservationRejected.title"](); // "Reservation Could Not Be Confirmed"
      default:
        return m["reservationSubmitted.title"](); // "Reservation Received"
    }
  };

  const getStatusMessage = () => {
    if (customMessage) {
      return customMessage;
    }

    if (type === "training-room" && status === "submitted") {
      return m["trainingReservation.confirmation.message"]();
    }

    switch (status) {
      case "confirmed":
        return m["thankYou.confirmation"](); // "Great news! Your reservation has been confirmed."
      case "rejected":
        return m["reservationRejected.message"](); // "Unfortunately, we're unable to accommodate..."
      default:
        return m["reservationSubmitted.message"](); // "We've received your reservation request..."
    }
  };

  return (
    <div className="container max-w-4xl mx-auto py-12 px-4">
      {/* Status Header */}
      <div className="text-center mb-8">
        <div className="mb-4">
          <ReservationStatusBadge status={status} />
        </div>
        <div className={statusIconWrapperVariants({ status })}>
          <StatusIcon status={status} />
        </div>
        <h1 className={statusTitleVariants({ status })}>{getStatusTitle()}</h1>
        <p className="text-gray-600 text-lg">{getStatusMessage()}</p>
        {details.id && (
          <Badge variant="outline" className="mt-4 px-4 py-2">
            {m["thankYou.bookingId"]({ id: details.id })}
          </Badge>
        )}
      </div>

      {/* Reservation Details */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className={statusIconSmallVariants({ status })} />
            {type === "training-room"
              ? m["trainingReservation.details.title"]()
              : m["thankYou.bookingDetails"]()}
          </CardTitle>
          <CardDescription>
            {type === "training-room"
              ? m["trainingReservation.details.description"]()
              : m["descriptions.keepInfo"]()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Date & Time */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">
                    {m["tableReservation.dateLabel"]()}
                  </p>
                  <p className="text-gray-600">{formattedDate}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">
                    {m["tableReservation.timeLabel"]()}
                  </p>
                  <p className="text-gray-600">{formattedTime}</p>
                </div>
              </div>

              {details.durationMinutes && (
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="font-medium">
                      {m["tableReservation.durationLabel"]()}
                    </p>
                    <p className="text-gray-600">
                      {formatDurationMinutes(details.durationMinutes, locale)}
                    </p>
                  </div>
                </div>
              )}

              {details.guestCount && (
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="font-medium">
                      {m["tableReservation.guestCountLabel"]()}
                    </p>
                    <p className="text-gray-600">
                      {m.guestCountPlural({ count: details.guestCount })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Contact Information */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-gray-500 rounded-full flex items-center justify-center">
                  <span className="text-xs text-white font-bold">
                    {details.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-medium">
                    {m["tableReservation.nameLabel"]()}
                  </p>
                  <p className="text-gray-600">{details.name}</p>
                </div>
              </div>

              {details.email && (
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="font-medium">
                      {m["tableReservation.emailLabel"]()}
                    </p>
                    <p className="text-gray-600">{details.email}</p>
                  </div>
                </div>
              )}

              {details.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="font-medium">
                      {m["tableReservation.phoneLabel"]()}
                    </p>
                    <p className="text-gray-600">{details.phone}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Additional Details */}
          {(details.tablePreference || details.specialRequests) && (
            <>
              <Separator className="my-6" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {details.tablePreference && (
                  <div>
                    <p className="font-medium mb-2">
                      {m["tableReservation.tablePreferenceLabel"]()}
                    </p>
                    <p className="text-gray-600">
                      {
                        {
                          private:
                            m[
                              "tableReservation.tablePreferences.privateSpace"
                            ](),
                          standard:
                            m["tableReservation.tablePreferences.standard"](),
                          large:
                            m[
                              "tableReservation.tablePreferences.largerTable"
                            ](),
                        }[details.tablePreference]
                      }
                    </p>
                  </div>
                )}

                {details.specialRequests && (
                  <div>
                    <p className="font-medium mb-2">
                      {m["tableReservation.specialRequestsLabel"]()}
                    </p>
                    <p className="text-gray-600">{details.specialRequests}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Next Steps - Only show for certain statuses */}
      {(status === "submitted" || status === "confirmed") && (
        <Card className={cn(statusCardVariants({ status }))}>
          <CardHeader>
            <CardTitle className={statusCardTitleVariants({ status })}>
              {m["thankYou.nextSteps"]()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("space-y-3", statusTextVariants({ status }))}>
              <p className={statusTextVariants({ status })}>
                {type === "training-room" && status === "submitted"
                  ? m["trainingReservation.nextSteps"]()
                  : status === "confirmed"
                    ? m["thankYou.nextStepsConfirmed"]()
                    : m["thankYou.nextStepsPending"]()}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contact Information */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>{m["thankYou.questions"]()}</CardTitle>
          <CardDescription>{m["thankYou.contactInfo"]()}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <Mail className={statusIconSmallVariants({ status })} />
              <div>
                <p className="font-medium">{m["labels.email"]()}</p>
                <p className={statusAccentTextVariants({ status })}>
                  {siteConstants.contact.reservationEmail}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Phone className={statusIconSmallVariants({ status })} />
              <div>
                <p className="font-medium">{m["labels.phone"]()}</p>
                <p className={statusAccentTextVariants({ status })}>
                  {formatPhoneNumber(siteConstants.contact.phone, locale)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button asChild className={statusButtonVariants({ status })}>
          <Link href="/">{m["thankYou.backToHome"]()}</Link>
        </Button>
      </div>
    </div>
  );
}
