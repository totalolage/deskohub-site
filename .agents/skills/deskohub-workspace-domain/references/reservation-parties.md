# Reservation parties

## Glossary

- **Reservation customer**: the Dotypos customer the reservation is for,
  stored as `workspace_reservations.dotypos_customer_id`. Dotypos owns the
  customer's profile. A customer who is "someone else" has no account.
- **Customer account**: the durable Workspace record of a signed-in
  customer, `public.customer_accounts`. Its id is the Better Auth user id that
  created it (`CustomerAccountId`), but it has no foreign key to `auth.user`,
  so it outlives the identity. It holds no personal data. While the identity
  exists, `customer_account_links` links the account to its own Dotypos
  customer.
- **Reservation author**: the customer account that made the reservation,
  stored as `workspace_reservations.author_account_id`. The author and the
  customer differ when an account books for someone else.
- **Deleted-account tombstone**: a customer account whose `deleted_at` is set.
  Account deletion leaves it so reservations keep their author after Better
  Auth removes the identity and its link.

## Invariants

- Every reservation a signed-in account creates records that account as its
  author. `OptionalAccountActivityGuard` hands the state-creating section the
  account it verified under the account lock; the reservation repository
  writes it and creates the account's record in the same transaction
  (`ensureCustomerAccount`).
- `author_account_id` references `customer_accounts` with `ON DELETE
  RESTRICT`. Never delete a customer account row; deletion tombstones it.
- `author_account_id` is null only for guest checkouts and for reservations
  made before authors were recorded, until the legacy backfill fills them and
  the column becomes NOT NULL.
- A customer account row appears when the account first authors a record, or
  as a tombstone when an account that never authored one is deleted.
