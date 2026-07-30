import { describe, expect, test } from "bun:test";

const checkoutRolloutNames = [
  "CHECKOUT_PAY_STATE_KEYS",
  "CHECKOUT_RESERVATION_HMAC_SECRET",
  "CHECKOUT_RESERVATION_HMAC_CUTOVER_AT",
  "CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL",
] as const;

const checkoutRolloutSection = [
  "# Checkout encrypted Pay-state key ring. Keep the exact bytes and entry order",
  "# unchanged throughout the reservation-HMAC bridge and legacy-read window.",
  "CHECKOUT_PAY_STATE_KEYS=",
  "",
  "# Reservation/session HMAC bridge. Leave the schedule fields unset during the",
  "# raw-write bridge deployment. See docs/checkout-lifecycle.md before scheduling",
  "# a cutover; never place secret material in documentation or source control.",
  "CHECKOUT_RESERVATION_HMAC_SECRET=",
  "CHECKOUT_RESERVATION_HMAC_CUTOVER_AT=",
  "CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL=",
  "",
].join("\n");

const validateCheckoutRolloutSection = (example: string): readonly string[] => {
  const failures: string[] = [];
  const sectionCount = example.split(checkoutRolloutSection).length - 1;
  if (sectionCount !== 1) failures.push("rollout_section_not_exactly_once");

  const assignmentLines = example
    .split(/\r?\n/)
    .filter((line) =>
      checkoutRolloutNames.some((name) => line.startsWith(`${name}=`))
    );
  const expectedAssignments = checkoutRolloutNames.map((name) => `${name}=`);
  if (assignmentLines.length !== expectedAssignments.length) {
    failures.push("rollout_assignment_count");
  }
  if (
    assignmentLines.some((line, index) => line !== expectedAssignments[index])
  ) {
    failures.push("rollout_assignments_not_blank_or_ordered");
  }

  return failures;
};

const trackedExamples = {
  boardgameBar: new URL(
    "../deskohub-boardgame-bar/.env.example",
    import.meta.url
  ),
  workspace: new URL("./.env.example", import.meta.url),
} as const;

const nonblankAssignments = (example: string) =>
  example
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=.+$/.test(line));

describe(".env.example checkout rollout section", () => {
  test("keeps every tracked example assignment blank", async () => {
    const assignments = await Promise.all(
      Object.entries(trackedExamples).map(async ([name, url]) => ({
        name,
        assignments: nonblankAssignments(await Bun.file(url).text()),
      }))
    );

    expect(assignments).toEqual([
      { name: "boardgameBar", assignments: [] },
      { name: "workspace", assignments: [] },
    ]);
  });

  test("is the exact contiguous blank 11-line non-secret section", async () => {
    const example = await Bun.file(
      new URL("./.env.example", import.meta.url)
    ).text();

    expect(checkoutRolloutSection.split("\n")).toHaveLength(11);
    expect(validateCheckoutRolloutSection(example)).toEqual([]);
  });

  test("fails deterministically for missing, duplicate, reordered, or nonblank assignments", () => {
    const document = `prefix\n${checkoutRolloutSection}suffix`;
    const missing = document.replace("CHECKOUT_RESERVATION_HMAC_SECRET=\n", "");
    const duplicate = `${document}\nCHECKOUT_RESERVATION_HMAC_SECRET=\n`;
    const reordered = document.replace(
      "CHECKOUT_RESERVATION_HMAC_CUTOVER_AT=\nCHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL=",
      "CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL=\nCHECKOUT_RESERVATION_HMAC_CUTOVER_AT="
    );
    const nonblank = document.replace(
      "CHECKOUT_RESERVATION_HMAC_SECRET=",
      "CHECKOUT_RESERVATION_HMAC_SECRET=SYNTHETIC_NON_SECRET_SENTINEL"
    );

    expect(validateCheckoutRolloutSection(missing)).toEqual([
      "rollout_section_not_exactly_once",
      "rollout_assignment_count",
      "rollout_assignments_not_blank_or_ordered",
    ]);
    expect(validateCheckoutRolloutSection(duplicate)).toEqual([
      "rollout_assignment_count",
      "rollout_assignments_not_blank_or_ordered",
    ]);
    expect(validateCheckoutRolloutSection(reordered)).toEqual([
      "rollout_section_not_exactly_once",
      "rollout_assignments_not_blank_or_ordered",
    ]);
    expect(validateCheckoutRolloutSection(nonblank)).toEqual([
      "rollout_section_not_exactly_once",
      "rollout_assignments_not_blank_or_ordered",
    ]);
  });
});
