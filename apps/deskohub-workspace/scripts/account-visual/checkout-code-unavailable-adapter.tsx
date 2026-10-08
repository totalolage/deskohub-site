import { CheckoutDiscountCodeForm } from "@/features/checkout/components/checkout-discount-code-form";
import { m } from "@/features/i18n";
import type { AccountVisualAdapterProps } from "./types";

export const accountVisualAdapterMetadata = {
  owner: "synthetic checkout component renderer",
  fixture:
    "actual discount-code form with a fixed unavailable error; code input is masked in screenshots",
} as const;

export function CheckoutCodeUnavailableAdapter({
  locale,
}: AccountVisualAdapterProps) {
  return (
    <main className="min-h-screen bg-[#f8f5ef] px-4 py-16 sm:px-6">
      <section className="mx-auto max-w-2xl rounded-3xl border border-[#dfe4ec] bg-white p-5 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold text-navy-blue sm:text-3xl">
          {m.checkoutPayTitle({}, { locale })}
        </h1>
        <div className="mt-6">
          <CheckoutDiscountCodeForm
            defaultCode="RFL12345"
            enabled
            fieldError
            locale={locale}
            payStateToken="synthetic-renderer-state"
          />
        </div>
      </section>
    </main>
  );
}

export default CheckoutCodeUnavailableAdapter;
