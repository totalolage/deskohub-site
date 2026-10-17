# Reservation parties

The account skill's [account domain and routes](../../deskohub-workspace-account/references/account-domain-and-routes.md#durable-customer-account)
reference covers how these parties are stored.

## Glossary

- **Reservation customer**: the customer the reservation is for. Dotypos owns
  the customer's profile. The customer can be the author's own customer, a
  different registered customer, or someone without an account.
- **Customer account**: the durable Workspace record of a customer who signs
  in. It outlives the sign-in identity and holds no personal data.
- **Reservation author**: the customer account that made the reservation. The
  author and the customer differ when an account books for someone else.
- **Deleted-account tombstone**: a customer account that was deleted. It stays
  so the reservations it authored keep their author.

## Invariants

- The submission that creates a reservation records the signed-in account as
  its author.
- A signed-in submission that resumes an authorless draft records that account
  as its author. Payment does not establish authorship; an authorless legacy
  reservation stays authorless until the #682 backfill.
- A reservation's author never changes once recorded. Any account can pay a
  reservation without becoming its author, but another account can't resume
  its draft.
- Account deletion turns the customer account into a tombstone; it never
  removes it.
