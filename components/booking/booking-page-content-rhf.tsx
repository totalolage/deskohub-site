"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/hooks/use-toast";
import { m } from "@/i18n";
import { BookingFormRHF } from "./booking-form-rhf";
import type { BookingFormData } from "@/lib/schemas/booking";

// Convert BookingFormData to FormData for server action compatibility
function convertToFormData(data: BookingFormData): FormData {
  const formData = new FormData();
  
  // Convert datetime to ISO string
  formData.append("datetime", data.datetime.toISOString());
  formData.append("guestCount", data.guestCount.toString());
  formData.append("name", data.name);
  formData.append("email", data.email);
  formData.append("phone", data.phone);
  
  if (data.tablePreference) {
    formData.append("tablePreference", data.tablePreference);
  }
  
  if (data.specialRequests) {
    formData.append("specialRequests", data.specialRequests);
  }
  
  return formData;
}

type ActionState = {
  success: boolean;
  message: string;
  errors: Record<string, string[]>;
  data?: BookingFormData;
  formData?: Record<string, string>;
};

export function BookingPageContentRHF() {
  const [isPending, startTransition] = useTransition();
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const { toast } = useToast();

  const handleSubmit = async (data: BookingFormData) => {
    startTransition(async () => {
      try {
        // Import the server action dynamically to avoid SSR issues
        const { submitBooking } = await import("@/app/actions/booking");
        
        // Convert react-hook-form data to FormData
        const formData = convertToFormData(data);
        
        // Initial state for useActionState compatibility
        const initialState: ActionState = {
          success: false,
          message: "",
          errors: {},
          formData: {},
        };
        
        // Call the server action
        const result = await submitBooking(initialState, formData);
        
        if (result.success) {
          // Clear any previous errors
          setServerErrors({});
          
          // Show success toast
          toast({
            title: m["booking.successTitle"](),
            description: m["booking.successMessage"](),
            variant: "default", // Changed from "success" to "default" as "success" might not exist
          });
          
          // Optionally reset form or redirect
          // form.reset() would be called here if we had access to the form instance
          
        } else {
          // Set server errors for display
          setServerErrors(result.errors);
          
          // Show error toast
          toast({
            title: m["booking.errorTitle"](),
            description: result.message || m["booking.errorMessage"](),
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Submission error:", error);
        
        // Show generic error toast
        toast({
          title: m["booking.errorTitle"](),
          description: m["booking.errorMessage"](),
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="space-y-6">
      <BookingFormRHF
        action={handleSubmit}
        isSubmitting={isPending}
        serverErrors={serverErrors}
      />
    </div>
  );
}
