"use client";

import { useActionState, useEffect } from "react";
import { submitBooking } from "@/app/actions/booking";
import { useToast } from "@/hooks/use-toast";
import { m } from "@/i18n";
import { BookingForm } from "./booking-form";

const initialState = {
  success: false,
  message: "",
  errors: {},
  formData: {},
} as const;

export function BookingPageContent() {
  const [state, formAction] = useActionState(submitBooking, initialState);
  const { toast } = useToast();

  // Show toast notifications when state changes
  useEffect(() => {
    if (state.success && state.message) {
      toast({
        title: m["booking.successTitle"](),
        description: m["booking.successMessage"](),
        variant: "success",
      });
    } else if (!state.success && state.message) {
      toast({
        title: m["booking.errorTitle"](),
        description: state.message,
        variant: "destructive",
      });
    }
  }, [state.success, state.message, toast]);

  return (
    <div className="space-y-6">
      {/* Booking Form */}
      <BookingForm
        formAction={formAction}
        errors={state.errors}
        formData={state.formData}
      />
    </div>
  );
}
