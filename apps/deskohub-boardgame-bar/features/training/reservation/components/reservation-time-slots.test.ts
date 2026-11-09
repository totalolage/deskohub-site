import { describe, expect, test } from "bun:test";
import { trainingRoomTimeSlots } from "./reservation-time-slots";

describe("trainingRoomTimeSlots", () => {
  test("offers hourly 24-hour values from 08:00 to 18:00 with 12-hour labels", () => {
    expect(trainingRoomTimeSlots).toEqual([
      { value: "08:00", label: "8:00 AM" },
      { value: "09:00", label: "9:00 AM" },
      { value: "10:00", label: "10:00 AM" },
      { value: "11:00", label: "11:00 AM" },
      { value: "12:00", label: "12:00 PM" },
      { value: "13:00", label: "1:00 PM" },
      { value: "14:00", label: "2:00 PM" },
      { value: "15:00", label: "3:00 PM" },
      { value: "16:00", label: "4:00 PM" },
      { value: "17:00", label: "5:00 PM" },
      { value: "18:00", label: "6:00 PM" },
    ]);
  });
});
