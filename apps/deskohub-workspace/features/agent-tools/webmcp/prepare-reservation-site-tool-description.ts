// The page tool reservation pages register, kept apart from its browser
// implementation so the server can describe it, as llms.txt does.

export const prepareReservationToolName = "prepare_reservation";

export const prepareReservationToolDescription =
  "Prepares a reservation in this browser tab up to the Pay page. It fills the reservation form on this page with a complete selection, the same input get_quote takes, waits for the live price and availability, and submits the form with the contact details the customer has already entered or the signed-in account. It never asks for or changes contact details: when some are missing, it says which, and the customer fills them in. For a selection in another reservation family, it opens that reservation page and continues there. Set marketingConsent to true only when the customer has explicitly asked in this conversation to receive marketing communication; never infer or default it. The customer accepts the terms and operating rules and pays on the Pay page; this tool cannot do either.";
