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

- Every reservation a signed-in account makes records that account as its
  author.
- A reservation started before the customer signed in takes the signed-in
  account as its author when that account resumes or pays it.
- A reservation's author never changes once recorded. Another account can pay
  the reservation without becoming its author, but can't resume its draft.
- Account deletion turns the customer account into a tombstone; it never
  removes it.
