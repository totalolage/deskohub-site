# Workspace reservation products

Workspace offers three reservation families: cowork, meeting room, and office. Each family owns its selection rules, availability, customer summary, and product identity; checkout must not treat one family as the default for another.

## Cowork

Cowork offers are exactly two, both for a single Prague calendar date:

- **Open Space** (CZK 290/day): a shared desk available Prague-local 00:00
  until 17:00 exclusive on the reserved date. An optional coffee addon costs
  CZK 50. Open Space is never marketed as 24/7 access.
- **Reserved Desk** (CZK 410/day, coffee included): a reserved desk for the
  whole Prague calendar day (midnight to next midnight, DST-correct) with
  24/7 code access. An optional workstation addon costs CZK 120/day and is
  selectable only as one of the four existing monitor configurations; the
  chosen configuration changes availability and the reserved product
  composition, never the price. When no bare Reserved Desk is available for a
  date but at least one valid workstation configuration is available, the
  customer must reserve a workstation and choose from the available monitor
  configurations. The advertised and accepted price includes an additional
  CZK 120/day for the workstation. The customer cannot select an unavailable
  exact configuration. Reserved Desk cannot be selected when neither a bare
  desk nor any workstation configuration is available for the full calendar
  date.

Historical entry tiers (basic, plus, profi) remain decodable for stored
reservations and reporting but are no longer saleable. A cowork discount
applies to the base price of both current offers; coffee and workstation
addons stay outside the discountable subtotal.

When assigning Reserved Desk, Workspace ranks tables as though every enabled,
visible, assignable Open Space table were occupied up to its configured seat
capacity. Ranking uses the greater of actual occupancy and that capacity;
actual occupancy is not added to capacity. Actual occupancy alone determines
whether the selected table has room and what public availability reports. A
table configured for both offers remains eligible for Reserved Desk whenever
its actual capacity permits.

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

The complete Prague-midnight interval may not exceed 672 elapsed hours. This is evaluated independently of the calendar-day count: 28 selected days are normally 672 hours, are 671 hours across the spring daylight-saving transition, and are 673 hours across the autumn transition. An autumn-transition reservation is therefore limited to 27 selected days.

Office price is calculated per selected day from the daily office access price plus the daily seat price for every reserved seat. Every visible price comes from the current advertised offer rather than a separate display-only amount.

The office is exclusive for the complete selected date range. Any existing occupancy makes it unavailable, regardless of unused seat capacity.

## Cross-family rules

- The customer confirmation email contains a protected link to the dedicated reservation access page, never the door PIN itself. Once an authorized paid, locally and live-confirmed reservation has an issued PIN, the access page displays it together with the exact programmed access bounds. Igloohome's programmed AlgoPIN bounds alone determine when the lock accepts the code; there is no local display time gate, and display never extends the reserved use of the space. Payment redirects and fulfillment recovery remain on the separate reservation status page.
- Product identity includes the reservation family and every choice that changes the purchased product.
- Discount configuration may target a whole reservation family, while quotes and completed purchases preserve the exact selected product.
- Availability, pricing, summaries, persistence, confirmation, email, and status views dispatch each family explicitly.
- Adding a reservation family requires complete support at every issuing and consuming boundary before it becomes publicly selectable.

## Cross-family email policy

The current Open Space customer confirmation, preview, and retry emails list
all eligible named Open Space tables instead of the assigned table. Numeric
names are sorted and compacted only for consecutive runs of at least three;
pairs remain separate. Nonnumeric names follow in provider order. For example,
`9-12, 15, 16, wallee, gromice`. If no eligible named tables exist, the email
omits the table block and never falls back to an assigned table ID. Reserved
Desk, other reservation families, and historical cowork tiers retain assigned-
table email behavior.
