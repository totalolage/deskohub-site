import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/shared/polyfills/temporal";
import { ReservationDatePicker } from "./reservation-date-picker";

const mountPoint = document.getElementById("date-picker-test-root");

if (!mountPoint) {
  throw new Error("The date picker browser harness root is missing.");
}

function ControlledPicker() {
  const [value, setValue] = useState("2099-06-10");

  return (
    <ReservationDatePicker
      ariaLabel="Reservation date"
      locale="en-US"
      name="date"
      onChange={setValue}
      value={value}
    />
  );
}

createRoot(mountPoint).render(<ControlledPicker />);
