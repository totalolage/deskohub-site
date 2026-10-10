import { AdministrationLink as Link } from "./admin-link";
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
  const reservationCount = await count;
  if (reservationCount === 0) return null;

  return (
    <AdministrationAlert className="mb-6" status="error">
      <p className="font-semibold">
        {reservationCount === 1
          ? "1 reservation needs a refund."
          : `${reservationCount} reservations need a refund.`}
      </p>
      <p>
        Their payment was received, but the reservation could not be provided or
        was cancelled. Refunds are not issued automatically; refund them in Nexi
        and they leave this list once Nexi reports the refund.
      </p>
      <Link
        className="mt-1 inline-block font-semibold underline underline-offset-4"
        href="/admin/reservations?status=needs_refund"
      >
        Review refunds
      </Link>
    </AdministrationAlert>
  );
}
