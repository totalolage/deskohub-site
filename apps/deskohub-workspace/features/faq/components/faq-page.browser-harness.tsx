import { createRoot } from "react-dom/client";
import { FaqPage } from "@/features/faq";

const mountPoint = document.getElementById("faq-page-test-root");

if (!mountPoint) {
  throw new Error("The FAQ browser harness root is missing.");
}

createRoot(mountPoint).render(
  <FaqPage
    averageReservationsPerDay={2.36}
    coworkSeatCapacity={17}
    locale="en-US"
  />
);
