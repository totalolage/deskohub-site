import { Effect } from "effect";
import { Calendar, Clock, Mail, Phone, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DotyposServiceLive, getReservation } from "@/features/dotypos";
import { m, setLocale } from "@/i18n";
import { ScrollToTop } from "@/shared/components/scroll-to-top";
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
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale_id } from "./route";

export const generateMetadata = metadata({
  title: m["reservationConfirmation.pageTitle"](),
  description: m["reservationConfirmation.pageDescription"](),
});

export default async function ReservationConfirmationPage({
  params,
}: Readonly<RouteProps_locale_id>) {
  const { id, locale } = await params;
  setLocale(locale, { reload: false });

  // Fetch reservation from Dotypos with proper error handling
  const reservationResult = await Effect.runPromise(
    getReservation(id).pipe(
      Effect.provide(DotyposServiceLive),
      Effect.match({
        onFailure: (error) => {
          // Log error for debugging
          console.error("Failed to fetch reservation:", error);
          // Return null to trigger 404
          return null;
        },
        onSuccess: (reservation) => reservation,
      })
    )
  );

  // If reservation not found or error, show 404
  if (!reservationResult) {
    notFound();
  }

  // Map Dotypos response to our booking structure
  const booking = {
    id: reservationResult.id,
    datetime: reservationResult.datetime,
    duration: reservationResult.duration || 2, // Use duration from reservation, fallback to 2
    guestCount: reservationResult.guestCount,
    name: reservationResult.customerName,
    email: reservationResult.customerEmail || "",
    phone: reservationResult.customerPhone || "",
    tablePreference: "any" as const, // Default since it's not retrieved from note parsing yet
    specialRequests: reservationResult.specialRequests || "",
    submittedAt: reservationResult.createdAt,
  };

  const formattedDate = formatDate(booking.datetime, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = formatTime(booking.datetime, locale);

  return (
    <div className="container max-w-4xl mx-auto py-12 px-4">
      <ScrollToTop />
      {/* Success Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            role="img"
            aria-label={m["accessibility.successCheckmark"]()}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-green-800 mb-2">
          {m["thankYou.title"]()}
        </h1>
        <p className="text-gray-600 text-lg">{m["thankYou.confirmation"]()}</p>
        <Badge variant="outline" className="mt-4 px-4 py-2">
          {m["thankYou.bookingId"]({ id })}
        </Badge>
      </div>

      {/* Booking Details */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-600" />
            {m["thankYou.bookingDetails"]()}
          </CardTitle>
          <CardDescription>{m["descriptions.keepInfo"]()}</CardDescription>
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
                  <p className="font-medium">{m["booking.durationLabel"]()}</p>
                  <p className="text-gray-600">
                    {m.durationFormat({ hours: booking.duration })}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">{m["booking.timeLabel"]()}</p>
                  <p className="text-gray-600">{formattedTime}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">
                    {m["booking.guestCountLabel"]()}
                  </p>
                  <p className="text-gray-600">
                    {m.guestCountPlural({ count: booking.guestCount })}
                  </p>
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-gray-500 rounded-full flex items-center justify-center">
                  <span className="text-xs text-white font-bold">
                    {booking.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-medium">{m["booking.nameLabel"]()}</p>
                  <p className="text-gray-600">{booking.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">{m["booking.emailLabel"]()}</p>
                  <p className="text-gray-600">{booking.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="font-medium">{m["booking.phoneLabel"]()}</p>
                  <p className="text-gray-600">{booking.phone}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Additional Details */}
          <Separator className="my-6" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="font-medium mb-2">
                {m["booking.tablePreferenceLabel"]()}
              </p>
              <p className="text-gray-600">
                {m[`booking.tablePreferences.${booking.tablePreference}`]()}
              </p>
            </div>

            {booking.specialRequests && (
              <div>
                <p className="font-medium mb-2">
                  {m["booking.specialRequestsLabel"]()}
                </p>
                <p className="text-gray-600">{booking.specialRequests}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Next Steps */}
      <Card className="mb-8 bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-800">
            {m["thankYou.nextSteps"]()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-blue-700">
            <p className="text-blue-700">
              {m["thankYou.nextStepsDescription"]()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Contact Information */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>{m["thankYou.questions"]()}</CardTitle>
          <CardDescription>{m["thankYou.contactInfo"]()}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-medium">{m["labels.email"]()}</p>
                <p className="text-green-600">contact@deskohub.com</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-medium">{m["labels.phone"]()}</p>
                <p className="text-green-600">+420 123 456 789</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button asChild className="bg-green-600 hover:bg-green-700">
          <Link href="/">{m["thankYou.backToHome"]()}</Link>
        </Button>
      </div>
    </div>
  );
}
