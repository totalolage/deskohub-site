/** The training room's bookable start times, hourly from 8:00 AM to 6:00 PM. */
export const trainingRoomTimeSlots = Array.from({ length: 11 }, (_, index) => {
  const hour = index + 8;

  return {
    value: `${hour.toString().padStart(2, "0")}:00`,
    label: `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`,
  };
});
