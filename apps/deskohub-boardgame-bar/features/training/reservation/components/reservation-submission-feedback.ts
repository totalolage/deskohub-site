import { toast } from "sonner";
import { m } from "@/features/i18n";
import type { ReservationFormData } from "../schemas/reservation";

type ReservationSubmissionResult = {
  data?: { success?: boolean; redirectUrl?: string };
};

type ReservationFieldErrors = Partial<Record<string, string[] | undefined>>;

type ReservationSubmissionFailure = {
  error?: {
    serverError?: string;
    validationErrors?: { fieldErrors?: ReservationFieldErrors };
  };
};

interface ReservationSubmissionFeedbackTarget {
  /** Opens the confirmation page the action returned. */
  navigate: (url: string) => void;
  /** Shows a validation message on one form field. */
  setFieldError: (field: keyof ReservationFormData, message: string) => void;
}

/** The first message of each field the server rejected. */
const firstFieldErrors = (fieldErrors: ReservationFieldErrors = {}) =>
  Object.entries(fieldErrors).flatMap(([field, errors]) =>
    Array.isArray(errors)
      ? errors
          .slice(0, 1)
          .map(
            (message) => [field as keyof ReservationFormData, message] as const
          )
      : []
  );

/**
 * Reports the training room reservation action's outcome: a confirmed
 * submission toasts and opens its confirmation page, server validation
 * errors land on their fields, and any other failure toasts the server's
 * error or the generic one.
 */
export function reservationSubmissionFeedback({
  navigate,
  setFieldError,
}: ReservationSubmissionFeedbackTarget) {
  return {
    onSuccess: (result: ReservationSubmissionResult) => {
      if (!result?.data?.success) return;

      toast.success(m["trainingReservation.success.title"](), {
        description: m["trainingReservation.success.description"](),
      });
      if (result.data.redirectUrl) {
        navigate(result.data.redirectUrl);
      }
    },
    onError: (failure: ReservationSubmissionFailure) => {
      const validationErrors = failure?.error?.validationErrors;
      if (!validationErrors) {
        toast.error(m["trainingReservation.error.title"](), {
          description:
            failure?.error?.serverError ||
            m["trainingReservation.error.description"](),
        });
        return;
      }

      for (const [field, message] of firstFieldErrors(
        validationErrors.fieldErrors
      )) {
        setFieldError(field, message);
      }
    },
  };
}
