import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { AdministrationLink as Link } from "./admin-link";
import { m } from "./i18n";
import { AdministrationAlert } from "./notice";

/**
 * Keeps paid Nexi attempts awaiting refund work in front of operators until
 * the refund is handled. Renders nothing when the queue is empty.
 */
export async function RefundAttention({
  count,
}: {
  readonly count: Promise<number>;
}) {
  const [reservationCount, locale] = await Promise.all([
    count,
    getRequestLocale(),
  ]);
  if (reservationCount === 0) return null;

  return (
    <AdministrationAlert className="mb-6" status="error">
      <p className="font-semibold">
        {m.administrationRefundAttentionTitle(
          { count: reservationCount },
          { locale }
        )}
      </p>
      <p>{m.administrationRefundAttentionDescription({}, { locale })}</p>
      <Link
        className="mt-1 inline-block font-semibold underline underline-offset-4"
        href="/admin/reservations?status=needs_refund"
      >
        {m.administrationRefundAttentionReview({}, { locale })}
      </Link>
    </AdministrationAlert>
  );
}
