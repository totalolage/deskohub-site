import "server-only";

import { Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { LocalizedCopy } from "@/features/i18n";
import { getLocalizedParamsDecoder } from "@/features/i18n/server/route-params";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";
import { workspaceReservationIdSchema } from "./persistence-contracts";

type PrivateOrderPageProps = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

const decodeParams = getLocalizedParamsDecoder({
  orderId: workspaceReservationIdSchema,
});

const readParams = async (params: PrivateOrderPageProps["params"]) =>
  Option.getOrElse(decodeParams(await params), () => notFound());

/**
 * A page about one order, reached by a link only its customer holds. Its
 * metadata keeps it out of search results, names no URL for crawlers, and
 * sends no referrer, so the order link stays with the customer. A malformed
 * order ID is not found.
 */
export function privateOrderPage({
  title,
  description,
}: {
  /** A title that already names the site. */
  readonly title: LocalizedCopy;
  readonly description: LocalizedCopy;
}) {
  async function generateMetadata({
    params,
  }: PrivateOrderPageProps): Promise<Metadata> {
    const { locale } = await readParams(params);

    return {
      ...createNoindexedPageMetadata({
        locale,
        title: { absolute: title({}, { locale }) },
        description: description({}, { locale }),
      }),
      referrer: "no-referrer",
    };
  }

  /** The order ID from the route parameters; a malformed one is not found. */
  const readOrderId = async (params: PrivateOrderPageProps["params"]) =>
    (await readParams(params)).orderId;

  return { generateMetadata, readOrderId };
}
