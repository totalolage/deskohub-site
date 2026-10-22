import { type Locale, m } from "@/features/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";

/**
 * Takes the profile's place on a review account's page: the account has no
 * profile, everything it books is simulated, and it can't be deleted.
 */
export function ReviewAccountCard({ locale }: { readonly locale: Locale }) {
  return (
    <Card
      className="mx-auto max-w-2xl rounded-3xl border-white/70 bg-white/92 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]"
      id="account-review-account"
    >
      <CardContent className="p-6 @xl:p-10">
        <h2 className="text-3xl text-navy-blue @xl:text-4xl">
          {m.accountReviewTitle({}, { locale })}
        </h2>
        <p className="mt-3 text-sm leading-6 text-navy-blue/68">
          {m.accountReviewBody({}, { locale })}
        </p>
        <p className="mt-3 text-sm leading-6 text-navy-blue/68">
          {m.accountReviewDeletionUnavailable({}, { locale })}
        </p>
      </CardContent>
    </Card>
  );
}
