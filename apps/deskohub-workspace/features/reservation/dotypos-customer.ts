import { Schema } from "effect";

export const dotyposCustomerIdSchema = Schema.Trim.check(Schema.isNonEmpty())
  .pipe(Schema.brand("DotyposCustomerId"))
  .annotate({
    identifier: "DotyposCustomerId",
    description: "A stable Dotypos customer identity.",
  });

export type DotyposCustomerId = typeof dotyposCustomerIdSchema.Type;
