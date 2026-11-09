# `dhw` Workspace administration

`dhw` gives authorized Deskohub operators a command-line view of the same Workspace administration capabilities available in the operator dashboard.

## Authentication and sessions

An operator starts authentication in the CLI and approves the short-lived request in the administration while signed in to an account that holds the administrator role. Successful approval creates a named administration session for that device. The session acts as the approving account: it records that account on the invoices and access codes it creates, and it stops working as soon as the account loses the administrator role.

Sessions may be listed, renamed, and revoked. A session label helps an operator recognize a device but does not change its identity or access. Revoked access is removed from the device when the service reports it.

## Read capabilities

Operators may read:

- the administration overview, including recent and new customers and reservations awaiting refund work;
- reservations and their current lifecycle;
- bookings, payment orders, and payment operations;
- all linked reservations per day over the last year;
- customers, their Workspace reservation history, and their reservations per day over the last year;
- discount definitions, codes, scheduled sales, and the Dotypos discount groups;
- invoice creation defaults, and a rendered preview of an invoice before it's created;
- email campaigns, their per-locale texts, current recipients, and delivery status;
- saved campaign audiences and email templates, including rendered template previews, and the inbox that receives test emails;
- automated campaigns: their flow, activation readiness, dry runs, published versions, runs with their timelines and counts, and the automation engine's health;
- descriptions and next starts of calendar expressions;
- the accounts that hold the administrator role; and
- issued administration sessions.

Search and filters use the same business definitions as the dashboard. Human output is compact; machine-readable output retains the complete supported result without changing the meaning of a command.

## Mutation capabilities

Operators may:

- create, update, disable, or delete eligible discounts and codes;
- assign product families and customer audiences to a code;
- set or clear a customer's discount group;
- create, update, duplicate, or delete draft email campaigns, sent once or by an automation, with each locale's body written in Markdown;
- replace an automated campaign's flow, dry-run it, activate it after a completed dry run of the current draft, and pause, resume, or archive it;
- create, update, archive, unarchive, or delete saved campaign audiences;
- send a campaign's test emails, then send the campaign with the confirmation code from the latest test email, and retry the recipients it didn't reach, optionally including those whose delivery is unconfirmed and who may already have the email;
- fill the booked product of older meeting-room and office reservations from their Dotypos booking, first as a dry run;
- grant an account the administrator role, or revoke another account's role;
- grant an account the administrator role and link the records a pre-account administrator username wrote to it, first as a dry run; and
- rename or revoke administration sessions.

Creating a code may create its discount benefit atomically. Fixed-money values use the currency's minor units. An omitted schedule or global-use limit means unrestricted along that dimension.

Destructive or access-broadening operations require explicit confirmation. This includes granting or revoking the administrator role, deleting resources, removing the final audience restriction, revoking a session, changing a customer's discount group, removing a customer from a restricted code, archiving or deleting a campaign audience, deleting a campaign, sending or retrying a campaign, activating, pausing, resuming, or archiving an automation, or filling reservation products. Non-interactive execution must provide that confirmation deliberately.

Discount-management mutations and the creation or duplication of campaigns and campaign audiences are safe to retry after an ambiguous connection failure. The same administration session and request identity must return the original result rather than apply the mutation twice.

## Product support

The CLI supports current macOS and Linux builds. Windows is not currently supported. Interactive commands may offer a verified update, while machine-readable, redirected, and automated invocations remain stable and non-interactive.
