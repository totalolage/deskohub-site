import { getLocale, m } from "@/features/i18n";
import { Price } from "@/shared/components";
import { cn } from "@/shared/utils";
import { siteConstants } from "@/shared/utils/constants";
import {
  formatEntranceFeeTiersStartDate,
  getEntranceFeeTiersPhase,
} from "@/shared/utils/pricing-policy";

export function EntranceFeesTiers() {
  const phase = getEntranceFeeTiersPhase();
  const tiersStartDate = formatEntranceFeeTiersStartDate(getLocale());
  const tierCopy = {
    newbie: {
      name: m["entranceFees.tiers.newbie.name"](),
      consumption: m["entranceFees.tiers.newbie.consumption"](),
      className: "text-gray-400",
    },
    regular: {
      name: m["entranceFees.tiers.regular.name"](),
      consumption: m["entranceFees.tiers.regular.consumption"](),
      className: "text-amber-600",
    },
    elite: {
      name: m["entranceFees.tiers.elite.name"](),
      consumption: m["entranceFees.tiers.elite.consumption"](),
      className: "text-gray-200",
    },
    sTier: {
      name: m["entranceFees.tiers.sTier.name"](),
      consumption: m["entranceFees.tiers.sTier.consumption"](),
      className: "text-yellow-400",
    },
  };

  return (
    <section className="py-16">
      <div className="max-w-3xl mx-auto px-6">
        {phase !== "active" && (
          <p className="text-center text-sm uppercase tracking-wide text-gray-400 mb-6">
            {m["entranceFees.effectiveFrom"]({ tiersStartDate })}
          </p>
        )}
        <div className="overflow-hidden rounded-lg border border-green-400/20">
          <table className="w-full text-center">
            <thead className="bg-white/5 text-sm uppercase text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-4" />
                <th scope="col" className="px-6 py-4">
                  {m["entranceFees.consumptionLabel"]()}
                </th>
                <th scope="col" className="px-6 py-4">
                  {m["entranceFees.feeLabel"]()}
                </th>
              </tr>
            </thead>
            <tbody>
              {siteConstants.pricing.entranceFeeTiers.map((tier) => (
                <tr key={tier.id} className="border-t border-white/10">
                  <th
                    scope="row"
                    className={cn(
                      "px-6 py-4 font-bold",
                      tierCopy[tier.id].className
                    )}
                  >
                    {tierCopy[tier.id].name}
                  </th>
                  <td className="px-6 py-4 text-gray-300">
                    {tierCopy[tier.id].consumption}
                  </td>
                  <td className="px-6 py-4 text-white">
                    {tier.fee === 0 ? (
                      m["entranceFees.tiers.free"]()
                    ) : (
                      <Price amount={tier.fee} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
