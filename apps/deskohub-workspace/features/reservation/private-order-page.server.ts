import "server-only";

import { Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { LocalizedCopy } from "@/features/i18n";
import { getLocalizedParamsDecoder } from "@/features/i18n/server/route-params";
import { getPageMetadata } from "@/shared/utils/page-metadata";
import { workspaceReservationIdSchema } from "./persistence-contracts";

type PrivateOrderPageProps = {
  readonly params: Promise<{ orderId: string }>;
};

const decodeParams = getLocalizedParamsDecoder({
  orderId: workspaceReservationIdSchema,
});

const readParams = async (params: PrivateOrderPageProps["params"]) =>
  Option.getOrElse(decodeParams(await params), () => notFound());

/**
 * A page about one order, reached by a link only its customer holds, at
 * `${pathname}/[orderId]`. Its metadata keeps it out of search results and
 * sends no referrer, so the order link stays with the customer. A malformed
 * order ID is not found.
 */
export function privateOrderPage({
  pathname,
  title,
  description,
}: {
  readonly pathname: string;
  readonly title: LocalizedCopy;
  readonly description: LocalizedCopy;
}) {
  async function generateMetadata({
    params,
  }: PrivateOrderPageProps): Promise<Metadata> {
    const { locale, orderId } = await readParams(params);

    return {
      ...getPageMetadata(locale, `${pathname}/${orderId}`, {
        title: title({}, { locale }),
        description: description({}, { locale }),
      }),
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    };
  }

  /** The order ID from the route parameters; a malformed one is not found. */
  const readOrderId = async (params: PrivateOrderPageProps["params"]) =>
    (await readParams(params)).orderId;

  return { generateMetadata, readOrderId };
}
