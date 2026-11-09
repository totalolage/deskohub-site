import { describe, expect, test } from "bun:test";
import {
  getTrainingRoomConfirmationDetails,
  getTrainingRoomDisplayName,
} from "./confirmation-details";

const noContact = {
  company: undefined,
  firstName: undefined,
  lastName: undefined,
  role: undefined,
};

describe("getTrainingRoomDisplayName", () => {
  test("names the company with its complete contact person", () => {
    expect(
      getTrainingRoomDisplayName({
        company: "Acme",
        firstName: "Jana",
        lastName: "Nováková",
        role: "HR",
      })
    ).toBe("Acme - Jana Nováková (HR)");
  });

  test("names only the company when the contact person is incomplete", () => {
    expect(
      getTrainingRoomDisplayName({
        ...noContact,
        company: "Acme",
        firstName: "Jana",
        lastName: "Nováková",
      })
    ).toBe("Acme");
    expect(
      getTrainingRoomDisplayName({ ...noContact, company: "Acme", role: "HR" })
    ).toBe("Acme");
  });

  test("names the person without a company", () => {
    expect(
      getTrainingRoomDisplayName({
        ...noContact,
        firstName: "Jana",
        lastName: "Nováková",
        role: "HR",
      })
    ).toBe("Jana Nováková");
  });

  test("is empty without a company or a full personal name", () => {
    expect(getTrainingRoomDisplayName(noContact)).toBe("");
    expect(
      getTrainingRoomDisplayName({ ...noContact, firstName: "Jana" })
    ).toBe("");
  });
});

describe("getTrainingRoomConfirmationDetails", () => {
  test("maps every submitted parameter", () => {
    expect(
      getTrainingRoomConfirmationDetails({
        company: "Acme",
        email: "jana@example.test",
        phone: "+420 777 000 000",
        date: "2026-11-20",
        time: "09:00",
        duration: "120",
        specialRequirements: "Projector",
      })
    ).toEqual({
      id: "",
      name: "Acme",
      email: "jana@example.test",
      phone: "+420 777 000 000",
      date: new Date("2026-11-20"),
      time: "09:00",
      duration: 120,
      specialRequests: "Projector",
    });
  });

  test("falls back to empty contact fields, no duration, and the current date", () => {
    const before = Date.now();
    const details = getTrainingRoomConfirmationDetails({});
    const after = Date.now();

    expect(details).toMatchObject({
      id: "",
      name: "",
      email: "",
      phone: "",
      time: "",
      duration: undefined,
      specialRequests: undefined,
    });
    expect(details.date.getTime()).toBeGreaterThanOrEqual(before);
    expect(details.date.getTime()).toBeLessThanOrEqual(after);
  });
});
