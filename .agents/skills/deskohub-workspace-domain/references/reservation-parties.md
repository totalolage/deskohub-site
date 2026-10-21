# Reservation parties

The account skill's [account domain and routes](../../deskohub-workspace-account/references/account-domain-and-routes.md#durable-customer-account)
reference covers how these parties are stored.

## Glossary

- **Reservation customer**: the customer the reservation is for. Dotypos owns
  the customer's profile. The customer is the author's own customer, or
  someone else the author books for, who may or may not have an account.
- **Customer account**: the durable Workspace record of a customer who signs
  in. It outlives the sign-in identity and holds no personal data.
- **Reservation author**: the customer account that made the reservation. The
  author and the customer differ when an account books for someone else.
- **Deleted-account tombstone**: a customer account that was deleted. It stays
  so the reservations it authored keep their author.
- **Booking agent**: the customer's AI agent, by OAuth client ID
  (`agent_client_id`), that started a reservation through the customer MCP
  server for its author. It records the channel, not a party: the author is
  still the signed-in account.

## Invariants

- Checkout requires a signed-in account with a verified email, so the
  submission that creates a reservation always records that account as its
  author.
- Every reservation has an author, including those made before authors were
  recorded, which the #682 backfill attributed. Payment does not establish
  authorship.
- A reservation's author never changes once recorded. Any account can pay a
  reservation without becoming its author, but another account can't resume
  its draft or supersede it from the same checkout session.
- Account deletion turns the customer account into a tombstone; it never
  removes it.
