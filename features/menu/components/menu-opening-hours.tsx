import { m } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";

export function MenuOpeningHours() {
  return (
    <div className="text-center mb-16">
      <div className="inline-flex bg-black/60 backdrop-blur-sm rounded-lg p-6 border border-green-400/20">
        <div className="text-center mr-8">
          <div className="text-green-400 font-semibold mb-2">
            {m["menu.openingHours.weekdays"]()}
          </div>
          <div className="text-white text-xl">
            {m["menu.openingHours.weekdaysTime"]({
              hours: siteConstants.workingHours.weekdays.formattedNoSpaces,
            })}
          </div>
        </div>
        <div className="text-center">
          <div className="text-green-400 font-semibold mb-2">
            {m["menu.openingHours.weekend"]()}
          </div>
          <div className="text-white text-xl">
            {m["menu.openingHours.weekendTime"]({
              hours: siteConstants.workingHours.weekends.formattedNoSpaces,
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
