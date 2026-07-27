# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Deskohub customers reserve cowork and meeting-room products. Deskohub operators maintain the product configuration used by those reservation and checkout flows, including discounts and sales.

## Product Purpose

Deskohub Workspace lets customers discover, price, reserve, and pay for Workspace products. Operational administration should make app-owned configuration safe to maintain without requiring direct database access.

## Operating Context

Discount definitions and codes live in Workspace Postgres. A dedicated Google Calendar is the read-only scheduling surface for sales: an all-day event owns timing, while its description references exactly one database discount UUID.

## Capabilities and Constraints

- Discount definitions own complete Czech and English customer labels, one percentage or fixed-money adjustment, and one or more explicit product targets.
- Discount codes reference a discount definition and own enabled state, validity window, and optional global-use limit.
- Google Calendar remains read-only to the app. Operators associate an event by writing exactly one discount UUID in its Description field.
- Discount application and code-redemption records are immutable operational evidence.
- Administrative access uses HTTP Basic authentication checked against a credential hash supplied through server environment configuration.

## Evidence on Hand

The database schema, checkout discount providers, Calendar normalization, operational discount guide, and automated checkout coverage are the source of truth. No customer claims or external proof should be invented.

## Product Principles

- Preserve the price and label a customer affirmed.
- Keep scheduling ownership in Calendar and discount ownership in Postgres.
- Fail safely when configuration is malformed or historical evidence blocks deletion.
- Prefer a small, direct operator workflow over speculative administration features.
