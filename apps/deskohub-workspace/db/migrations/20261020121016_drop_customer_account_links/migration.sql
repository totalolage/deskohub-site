-- #682: customer_accounts.dotypos_customer_id replaced the link table, and
-- the previous release neither reads nor writes it. Release A still writes it,
-- so this runs only once no release-A deployment can serve.
DROP TABLE "customer_account_links";