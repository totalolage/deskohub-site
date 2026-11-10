import { describe, expect, test } from "bun:test";
import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { accountAtom } from "../customer-api/customer-data-runtime";
import {
  makeFakeCustomerData,
  settle,
} from "../customer-api/testing/customer-data-test-registry";
import {
  type SampleAccountKind,
  sampleWorkspaceData,
} from "../customer-api/testing/sample-fixtures";
import {
  type AccountNotice,
  type AccountSection,
  accountIndexModel,
  offersAccessCode,
  opensReservationStatus,
  reservationsAccess,
} from "./account-gating";

const accountOf = (kind: SampleAccountKind): CustomerAccountState =>
  sampleWorkspaceData(kind).account;

describe("accountIndexModel", () => {
  // biome-ignore format: the case table stays one row per line on purpose.
  const cases: ReadonlyArray<readonly [SampleAccountKind, ReadonlyArray<AccountSection>, AccountNotice | undefined]> = [
    ["linked", ["referrals", "profile", "language", "security", "assistants", "billing", "legal", "danger"], undefined],
    ["completion-required", ["complete", "language", "security", "assistants", "legal", "danger"], "completion-required"],
    ["support-required", ["language", "security", "assistants", "legal", "danger"], "support-required"],
    ["authenticated-unavailable", ["language", "security", "assistants", "legal", "danger"], "unavailable"],
    ["review-account", ["language", "security", "assistants", "legal"], undefined],
    ["deletion-pending", ["security", "legal", "danger"], "deletion-pending"],
  ];

  test.each(cases)("%s account", (kind, sections, notice) => {
    const model = accountIndexModel(accountOf(kind));

    expect(model.sections).toEqual(sections);
    expect(model.notice).toBe(notice);
    expect(model.deletionPending).toBe(kind === "deletion-pending");
  });

  test("hides referrals while the program isn't released", () => {
    const linked = accountOf("linked");
    if (linked.kind !== "linked") throw new Error("fixture is linked");

    expect(
      accountIndexModel({ ...linked, referralsEnabled: false }).sections
    ).not.toContain("referrals");
  });

  test("hides sign-in & security while passkeys aren't released", () => {
    const { passkeys: _withheld, ...linked } = accountOf("linked");

    expect(accountIndexModel(linked).sections).not.toContain("security");
  });

  test("offers the language to every account but one pending deletion", () => {
    const offered = (kind: SampleAccountKind) =>
      accountIndexModel(accountOf(kind)).sections.includes("language");

    expect(offered("completion-required")).toBe(true);
    expect(offered("authenticated-unavailable")).toBe(true);
    // The server refuses a pending deletion's preference writes.
    expect(offered("deletion-pending")).toBe(false);
  });

  test("hides the danger zone while deletion is withheld", () => {
    expect(
      accountIndexModel({
        ...accountOf("support-required"),
        deletion: "withheld",
      }).sections
    ).not.toContain("danger");
  });

  test("builds the index from the account the API returns", async () => {
    const { registry } = makeFakeCustomerData("completion-required");

    const result = await settle(registry, accountAtom);
    if (result._tag !== "Success") throw new Error("account didn't load");

    expect(accountIndexModel(result.success).sections).toEqual([
      "complete",
      "language",
      "security",
      "assistants",
      "legal",
      "danger",
    ]);
  });
});

describe("reservationsAccess", () => {
  // biome-ignore format: the case table stays one row per line on purpose.
  const cases: ReadonlyArray<readonly [SampleAccountKind, ReturnType<typeof reservationsAccess>]> = [
    ["linked", { kind: "available" }],
    ["review-account", { kind: "available" }],
    ["completion-required", { kind: "completion-required" }],
    ["support-required", { kind: "unavailable", notice: "support-required" }],
    ["authenticated-unavailable", { kind: "unavailable", notice: "unavailable" }],
    ["deletion-pending", { kind: "unavailable", notice: "deletion-pending" }],
  ];

  test.each(cases)("%s account", (kind, access) => {
    expect(reservationsAccess(accountOf(kind))).toEqual(access);
  });
});

describe("reservation links", () => {
  test("only a row with an order opens its status", () => {
    const { history } = sampleWorkspaceData("linked");

    expect(history.current.every(opensReservationStatus)).toBe(true);
    expect(history.unavailable.some(opensReservationStatus)).toBe(false);
  });

  test("a review-sandbox order offers no access code", () => {
    expect(offersAccessCode({ reviewSandbox: true })).toBe(false);
    expect(offersAccessCode({})).toBe(true);
  });
});
