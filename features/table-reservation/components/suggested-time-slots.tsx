import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";
import { formatTime } from "@/shared/utils";
import { siteConstants } from "@/shared/utils/constants";

const slotLengthAsTime =
  siteConstants.tableReservation.validation.time.minuteIncrement * 60 * 1000;

export const SuggestedTimeSlots = ({
  min,
  value,
  setTimeSlot,
}: {
  min: Date;
  value: Date;
  setTimeSlot: (slot: Date) => void;
}) => {
  const timeSinceMin = value.getTime() - min.getTime();
  const timeSlotsSinceMin = Math.floor(timeSinceMin / slotLengthAsTime);
  const closestSlotBefore =
    min.getTime() + timeSlotsSinceMin * slotLengthAsTime;
  const closestSlotAfter =
    min.getTime() + (timeSlotsSinceMin + 1) * slotLengthAsTime;

  const locale = useLocale();

  return (
    <div className="flex flex-col gap-2 px-4">
      {[closestSlotBefore, closestSlotAfter].map((slot) => {
        const slotDate = new Date(slot);
        return (
          <Button
            key={slot}
            variant="outline"
            onClick={() => setTimeSlot(slotDate)}
            className="flex items-center gap-2"
          >
            <div className="text-sm text-green-500">
              {formatTime(slotDate, locale)}
            </div>
          </Button>
        );
      })}
    </div>
  );
};
