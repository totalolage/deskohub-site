import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReservationPage } from "./reservation-page";

test("shows the page title as the visible h1 of the reservation page", () => {
  const html = renderToStaticMarkup(
    <ReservationPage fallback="Loading" locale="en-US" title="Page title">
      Reservation form
    </ReservationPage>
  );

  expect(html).toMatch(/<h1(?![^>]*\bsr-only\b)[^>]*>Page title<\/h1>/);
});
