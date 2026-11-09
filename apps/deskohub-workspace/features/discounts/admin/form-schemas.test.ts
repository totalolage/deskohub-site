import { describe, expect, test } from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { Schema } from "effect";
import type { FieldValues } from "react-hook-form";
import {
  createDiscountCodeCreationFormSchema,
  createDiscountDefinitionFormSchema,
  type DiscountCodeCreationFormValues,
  type DiscountDefinitionFormValues,
} from "./form-schemas";

const discountDefinitionFormSchema =
  createDiscountDefinitionFormSchema("en-US");
const discountCodeCreationFormSchema =
  createDiscountCodeCreationFormSchema("en-US");

// Resolves through the same resolver the administration forms use, so each
// failing field is one that would render its message beside that input.
const failingFields = async <Values extends FieldValues>(
  schema: Schema.Codec<unknown, Values>,
  values: Values
) => {
  const { errors } = await effectSchemaResolver(schema)(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  return Object.keys(errors).sort();
};

const discountDefinition = (
  overrides: Partial<DiscountDefinitionFormValues> = {}
): DiscountDefinitionFormValues => ({
  labelEn: "Summer discount",
  labelCs: "Letní sleva",
  adjustmentKind: "percentage",
  percentage: "10",
  fixedAmountValue: "10000",
  fixedAmountCurrency: "CZK",
  products: [],
  ...overrides,
});

const codeConfiguration = {
  code: "SUMMER10",
  enabled: true,
  validFrom: "",
  validUntil: "",
  maxUses: "",
  maxUsesPerCustomer: "",
};

const discountCodeCreation = (
  overrides: Partial<DiscountCodeCreationFormValues> = {}
): DiscountCodeCreationFormValues => ({
  discountKind: "existing",
  discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
  ...discountDefinition(),
  ...codeConfiguration,
  ...overrides,
});

describe("discount definition form schema", () => {
  test.each([
    ["", false],
    ["0", false],
    ["0.009", false],
    ["0.01", true],
    ["100", true],
    ["100.01", false],
    ["ten", false],
  ])(
    "accepts percentage %p only within 0.01 to 100: %p",
    async (percentage, accepted) => {
      expect(
        await failingFields(
          discountDefinitionFormSchema,
          discountDefinition({ percentage })
        )
      ).toEqual(accepted ? [] : ["percentage"]);
    }
  );

  test.each([
    ["", false],
    ["0", false],
    ["1", true],
    ["1.5", false],
    ["9007199254740992", false],
  ])(
    "accepts fixed minor units %p only as a whole number of at least 1: %p",
    async (fixedAmountValue, accepted) => {
      expect(
        await failingFields(
          discountDefinitionFormSchema,
          discountDefinition({ adjustmentKind: "fixed", fixedAmountValue })
        )
      ).toEqual(accepted ? [] : ["fixedAmountValue"]);
    }
  );

  test.each([
    [["cowork"], true],
    [["cowork:open-space"], true],
    [["cowork:open-space", "cowork:reserved-desk", "office"], true],
    [["cowork", "cowork:reserved-desk"], false],
    [["cowork:open-space", "meeting-room", "cowork"], false],
  ] as const)(
    "accepts product keys %p only without broad cowork beside a tier: %p",
    async (products, accepted) => {
      expect(
        await failingFields(
          discountDefinitionFormSchema,
          discountDefinition({ products })
        )
      ).toEqual(accepted ? [] : ["products"]);
    }
  );

  test("explains an incoherent cowork selection", async () => {
    const { errors } = await effectSchemaResolver(discountDefinitionFormSchema)(
      discountDefinition({ products: ["cowork", "cowork:open-space"] }),
      undefined,
      { fields: {}, shouldUseNativeValidation: false }
    );
    expect(errors.products?.message).toBe(
      "Choose either all cowork tiers or specific cowork tiers, not both."
    );
  });

  test("explains validation failures in the operator's locale", async () => {
    const { errors } = await effectSchemaResolver(
      createDiscountDefinitionFormSchema("cs-CZ")
    )(
      discountDefinition({
        labelCs: " ",
        percentage: "120",
        products: ["cowork", "cowork:open-space"],
      }),
      undefined,
      { fields: {}, shouldUseNativeValidation: false }
    );
    expect(errors.labelCs?.message).toBe("Zadejte český název.");
    expect(errors.percentage?.message).toBe("Zadejte procento od 0,01 do 100.");
    expect(errors.products?.message).toBe(
      "Zvolte buď všechny úrovně coworku, nebo konkrétní úrovně, ne obojí."
    );
  });
});

describe("discount code creation form schema", () => {
  test("skips new-discount definition checks on the existing-discount branch", async () => {
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ labelEn: "", labelCs: "", percentage: "" })
      )
    ).toEqual([]);
  });

  test("checks the new definition instead of the discount choice on the new-discount branch", async () => {
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({
          discountKind: "new",
          discountId: "",
          labelEn: "",
          labelCs: "",
          percentage: "200",
        })
      )
    ).toEqual(["labelCs", "labelEn", "percentage"]);
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ discountKind: "new", discountId: "" })
      )
    ).toEqual([]);
  });

  test("checks the cowork selection only on the new-discount branch", async () => {
    const products = ["cowork", "cowork:reserved-desk"] as const;
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ products })
      )
    ).toEqual([]);
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ discountKind: "new", products })
      )
    ).toEqual(["products"]);
  });
});
