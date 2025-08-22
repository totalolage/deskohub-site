"use client";

import { Calendar, Clock, Mail, Phone, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { m } from "@/i18n/paraglide/messages";
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
import { formatDate, formatTime } from "@/shared/utils/date-formatting";
import { useLocale } from "@/i18n/utils/use-locale";

export type ReservationStatus = "submitted" | "confirmed" | "rejected";

export interface ReservationDetails {
  id?: string;
  name: string;
  email: string;
  phone: string;
  date: Date;
  time: string;
  duration?: number;
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

  const getStatusColor = () => {
    switch (status) {
      case "confirmed":
        return "green";
      case "rejected":
        return "red";
      case "submitted":
      default:
        return "blue";
    }
  };

  const color = getStatusColor();

  const getStatusIcon = () => {
    switch (status) {
      case "confirmed":
        return (
          <svg
            className={`w-8 h-8 text-${color}-600`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
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
            className={`w-8 h-8 text-${color}-600`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      case "submitted":
      default:
        return (
          <svg
            className={`w-8 h-8 text-${color}-600`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
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
  };

  const getStatusTitle = () => {
    if (type === "training-room" && status === "submitted") {
      return m["trainingReservation.confirmation.title"]();
    }
    
    switch (status) {
      case "confirmed":
        return m["thankYou.title"]();
      case "rejected":
        return m["reservationRejected.title"]();
      case "submitted":
      default:
        return m["reservationSubmitted.title"]();
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
        return m["thankYou.confirmation"]();
      case "rejected":
        return m["reservationRejected.message"]();
      case "submitted":
      default:
        return m["reservationSubmitted.message"]();
    }
  };

  return (
    <div className="container max-w-4xl mx-auto py-12 px-4">
      {/* Status Header */}
      <div className="text-center mb-8">
        <div className={`w-16 h-16 bg-${color}-100 rounded-full flex items-center justify-center mx-auto mb-4`}>
          {getStatusIcon()}
        </div>
        <h1 className={`text-3xl font-bold text-${color}-800 mb-2`}>
          {getStatusTitle()}
        </h1>
        <p className="text-gray-600 text-lg">{getStatusMessage()}</p>
        {details.id && (
          <Badge variant="outline" className="mt-4 px-4 py-2">
            {m["booking.bookingId"]({ id: details.id })}
          </Badge>
        )}
      </div>

      {/* Reservation Details */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className={`w-5 h-5 text-${color}-600`} />
            {type === "training-room" 
              ? m["trainingReservation.details.title"]()
              : m["booking.bookingDetails"]()}
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
                  <p className="font-medium">{m["booking.dateLabel"]()}</p>
                  <p className="text-gray-600">{formattedDate}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">{m["booking.timeLabel"]()}</p>
                  <p className="text-gray-600">{formattedTime}</p>
                </div>
              </div>

              {details.duration && (
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="font-medium">{m["booking.durationLabel"]()}</p>
                    <p className="text-gray-600">
                      {m.durationFormat({ hours: details.duration })}
                    </p>
                  </div>
                </div>
              )}

              {details.guestCount && (
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="font-medium">{m["booking.guestCountLabel"]()}</p>
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
                  <p className="font-medium">{m["booking.nameLabel"]()}</p>
                  <p className="text-gray-600">{details.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">{m["booking.emailLabel"]()}</p>
                  <p className="text-gray-600">{details.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">{m["booking.phoneLabel"]()}</p>
                  <p className="text-gray-600">{details.phone}</p>
                </div>
              </div>
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
                      {m["booking.tablePreferenceLabel"]()}
                    </p>
                    <p className="text-gray-600">
                      {{
                        private: m["booking.tablePreferences.privateSpace"](),
                        standard: m["booking.tablePreferences.standard"](),
                        large: m["booking.tablePreferences.largerTable"](),
                      }[details.tablePreference]}
                    </p>
                  </div>
                )}

                {details.specialRequests && (
                  <div>
                    <p className="font-medium mb-2">
                      {m["booking.specialRequestsLabel"]()}
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
        <Card className={`mb-8 bg-${color}-50 border-${color}-200`}>
          <CardHeader>
            <CardTitle className={`text-${color}-800`}>
              {m["thankYou.nextSteps"]()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`space-y-3 text-${color}-700`}>
              <p className={`text-${color}-700`}>
                {type === "training-room" && status === "submitted"
                  ? m["trainingReservation.nextSteps"]()
                  : m["thankYou.nextStepsDescription"]()}
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
              <Mail className={`w-5 h-5 text-${color}-600`} />
              <div>
                <p className="font-medium">{m["labels.email"]()}</p>
                <p className={`text-${color}-600`}>
                  {type === "training-room" 
                    ? "reservations@deskohub.cz"
                    : "contact@deskohub.com"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Phone className={`w-5 h-5 text-${color}-600`} />
              <div>
                <p className="font-medium">{m["labels.phone"]()}</p>
                <p className={`text-${color}-600`}>+420 123 456 789</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button asChild className={`bg-${color}-600 hover:bg-${color}-700`}>
          <Link href="/">{m["thankYou.backToHome"]()}</Link>
        </Button>
      </div>
    </div>
  );
}