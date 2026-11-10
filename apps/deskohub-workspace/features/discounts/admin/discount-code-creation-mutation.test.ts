import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { defaultWorkspaceCurrencyCode } from "@/shared/money/currencies";
import { toDiscountCodeCreationMutation } from "./discount-code-creation-mutation";
import type { DiscountCodeCreationFormValues } from "./form-schemas";

const discountId = "019c91dd-c560-7e55-b9d8-c95065efd51d";
const customerId = "dotypos-customer" as DotyposCustomerId;

const formValues = (
  overrides: Partial<DiscountCodeCreationFormValues> = {}
): DiscountCodeCreationFormValues => ({
  discountKind: "existing",
  discountId,
  labelEn: "Winter discount",
  labelCs: "Zimní sleva",
  adjustmentKind: "percentage",
  percentage: "15",
  fixedAmountValue: "10000",
  fixedAmountCurrency: defaultWorkspaceCurrencyCode,
  products: ["cowork"],
  code: " winter15 ",
  enabled: true,
  validFrom: "",
  validUntil: "",
  maxUses: "5",
  maxUsesPerCustomer: "",
  serviceDateFrom: "",
  serviceDateUntil: "",
  ...overrides,
});

const code = {
  code: "WINTER15",
  enabled: true,
  validFrom: null,
  validUntil: null,
  maxUses: 5,
  maxUsesPerCustomer: null,
  serviceDateFrom: null,
  serviceDateUntil: null,
};

describe("toDiscountCodeCreationMutation", () => {
  test("creates a general code for an existing discount", () => {
    expect(toDiscountCodeCreationMutation(formValues(), undefined)).toEqual(
      Option.some({
        kind: "create-code",
        code,
        discount: { kind: "existing", discountId },
      })
    );
  });

  test("creates a customer code with its reservation dates", () => {
    expect(
      toDiscountCodeCreationMutation(
        formValues({
          serviceDateFrom: "2026-07-01",
          serviceDateUntil: "2026-07-31",
        }),
        customerId
      )
    ).toEqual(
      Option.some({
        kind: "create-customer-code",
        customerId,
        code: {
          ...code,
          serviceDateFrom: "2026-07-01",
          serviceDateUntil: "2026-07-31",
        },
        discount: { kind: "existing", discountId },
      })
    );
  });

  test("restricts the code to the given customer", () => {
    expect(toDiscountCodeCreationMutation(formValues(), customerId)).toEqual(
      Option.some({
        kind: "create-customer-code",
        customerId,
        code,
        discount: { kind: "existing", discountId },
      })
    );
  });

  test("defines a new discount from the form's definition fields", () => {
    expect(
      toDiscountCodeCreationMutation(
        formValues({ discountKind: "new" }),
        customerId
      )
    ).toEqual(
      Option.some({
        kind: "create-customer-code",
        customerId,
        code,
        discount: {
          kind: "new",
          discount: {
            labels: { "cs-CZ": "Zimní sleva", "en-US": "Winter discount" },
            adjustment: { kind: "percentage", basisPoints: 1500 },
            products: [{ kind: "cowork" }],
          },
        },
      })
    );
  });

  test("asks for nothing when the new discount's fixed currency is outside the catalog", () => {
    expect(
      toDiscountCodeCreationMutation(
        formValues({
          discountKind: "new",
          adjustmentKind: "fixed",
          fixedAmountCurrency: "XTS",
        }),
        undefined
      )
    ).toEqual(Option.none());
  });
});
