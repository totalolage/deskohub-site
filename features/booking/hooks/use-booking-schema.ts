import { useMemo } from "react";
import { getBookingSchema } from "@/features/booking/schemas/booking";

export const useBookingSchema = () => {
  return useMemo(() => {
    return getBookingSchema();
  }, []); // Empty dependency array since translations are static
};
