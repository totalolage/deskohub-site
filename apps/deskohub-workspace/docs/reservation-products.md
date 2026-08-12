# Workspace reservation products

Workspace offers three reservation families: cowork, meeting room, and office. Each family owns its selection rules, availability, customer summary, and product identity; checkout must not treat one family as the default for another.

## Cowork

Cowork reservations select one of the offered entry tiers for a Workspace date. Optional equipment such as a monitor affects availability and the final reservation composition even when it has no price of its own.

The complete selected tier determines the cowork product. A discount that targets cowork applies across its eligible cowork tiers rather than depending on a hidden shorthand from another family.

## Meeting room

Meeting-room products are exactly:

- one hour;
- four hours; or
- one whole Prague calendar day.

A whole day runs from Prague midnight to the following Prague midnight. It remains a calendar day across daylight-saving changes and is not normalized to a fixed number of elapsed hours.

Hourly products begin at the selected local time. The selected duration remains part of the product the customer reviews and must not be inferred later from start and end timestamps.

A meeting-room reservation remains eligible for submission and payment after its start while its exclusive end is still in the future. It is no longer eligible after that end.

## Office

An office reservation spans an inclusive range of Prague calendar dates. The customer selects a start date, a positive number of days, and a positive number of seats supported by the office capacity.

The latest included date may not be more than one calendar month after the current Prague date. An unavailable date ends the longest range that can be selected from an earlier start.

Office price is calculated per selected day from the daily office access price plus the daily seat price for every reserved seat. Every visible price comes from the current advertised offer rather than a separate display-only amount.

The office is exclusive for the complete selected date range. Any existing occupancy makes it unavailable, regardless of unused seat capacity.

## Cross-family rules

- Product identity includes the reservation family and every choice that changes the purchased product.
- Discount configuration may target a whole reservation family, while quotes and completed purchases preserve the exact selected product.
- Availability, pricing, summaries, persistence, confirmation, email, and status views dispatch each family explicitly.
- Adding a reservation family requires complete support at every issuing and consuming boundary before it becomes publicly selectable.

## Customer cancellation policy

A customer may request cancellation by email. Meeting-room and office reservations receive a full refund when the request arrives at least 24 hours before the reservation begins. A same-day meeting-room or office reservation also has a five-minute full-refund grace period after the contract is concluded, provided the reservation has not begun. A cowork reservation receives a full contractual refund until its access PIN is delivered. These contractual benefits do not replace any mandatory consumer withdrawal or defective-performance rights.
