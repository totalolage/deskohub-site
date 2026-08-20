# `dhw` Workspace administration

`dhw` gives authorized Deskohub operators a command-line view of the same Workspace administration capabilities available in the operator dashboard.

## Authentication and sessions

An operator starts authentication in the CLI and approves the short-lived request through the existing protected administration experience. Successful approval creates a named administration session for that device.

Sessions may be listed, renamed, and revoked. A session label helps an operator recognize a device but does not change its identity or access. Revoked access is removed from the device when the service reports it.

## Read capabilities

Operators may read:

- the administration overview;
- reservations and their current lifecycle;
- bookings, payment orders, and payment operations;
- customers and their Workspace reservation history;
- discount definitions, codes, and scheduled sales; and
- issued administration sessions.

Search and filters use the same business definitions as the dashboard. Human output is compact; machine-readable output retains the complete supported result without changing the meaning of a command.

## Mutation capabilities

Operators may:

- create, update, disable, or delete eligible discounts and codes;
- assign product families and customer audiences to a code;
- set or clear a customer's discount group; and
- rename or revoke administration sessions.

Creating a code may create its discount benefit atomically. Fixed-money values use the currency's minor units. An omitted schedule or global-use limit means unrestricted along that dimension.

Destructive or access-broadening operations require explicit confirmation. This includes deleting resources, removing the final audience restriction, revoking a session, changing a customer's discount group, or removing a customer from a restricted code. Non-interactive execution must provide that confirmation deliberately.

Discount-management mutations are safe to retry after an ambiguous connection failure. The same administration session and request identity must return the original result rather than apply the mutation twice.

## Product support

The CLI supports current macOS and Linux builds. Windows is not currently supported. Interactive commands may offer a verified update, while machine-readable, redirected, and automated invocations remain stable and non-interactive.
