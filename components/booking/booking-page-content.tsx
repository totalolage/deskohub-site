"use client";

import { useActionState } from "react";
import { submitBooking } from "@/app/actions/booking";
import { m } from "@/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle, XCircle } from "lucide-react";
import { BookingForm } from "./booking-form";

const initialState = {
  success: false,
  message: '',
  errors: {},
} as const;

export function BookingPageContent() {
  const [state, formAction, isPending] = useActionState(submitBooking, initialState);

  return (
    <div className="space-y-6">
      {/* Success Alert */}
      {state.success && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800">{m["booking.successTitle"]()}</AlertTitle>
          <AlertDescription className="text-green-700">
            {m["booking.successMessage"]()}
          </AlertDescription>
        </Alert>
      )}

      {/* Error Alert */}
      {!state.success && state.message && (
        <Alert className="bg-red-50 border-red-200">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-800">{m["booking.errorTitle"]()}</AlertTitle>
          <AlertDescription className="text-red-700">
            {state.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Booking Form */}
      <BookingForm
        formAction={formAction}
        isPending={isPending}
        errors={state.errors}
      />
    </div>
  );
}