import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";
import { reservationSchema } from "./reservation";

const reservation = (identity: {
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
}) => ({
  firstName: "",
  lastName: "",
  company: "",
  role: "",
  email: "guest@example.test",
  phone: "777 123 456",
  date: new Date(2026, 11, 1),
  time: "10:00",
  duration: 2,
  specialRequirements: "",
  ...identity,
});

/** The path and message of every issue the schema reports. */
const issuesOf = (input: ReturnType<typeof reservation>) => {
  const result = reservationSchema.safeParse(input);
  return (
    result.error?.issues.map(({ path, message }) => ({ path, message })) ?? []
  );
};

describe("reservationSchema identification", () => {
  test("accepts a company without a contact name", () => {
    expect(issuesOf(reservation({ company: "Deskohub s.r.o." }))).toEqual([]);
  });

  test("accepts a full name without a company", () => {
    expect(
      issuesOf(reservation({ firstName: "Jana", lastName: "Nováková" }))
    ).toEqual([]);
  });

  test("asks for a company or a name when neither is filled in", () => {
    expect(
      issuesOf(reservation({ firstName: " ", lastName: " ", company: " " }))
    ).toEqual([
      {
        path: ["root"],
        message: m["trainingReservation.validation.companyOrNameRequired"](),
      },
    ]);
  });

  test("asks for the last name when only the first name is filled in", () => {
    expect(issuesOf(reservation({ firstName: "Jana" }))).toEqual([
      {
        path: ["lastName"],
        message: m["trainingReservation.validation.lastNameRequired"](),
      },
    ]);
  });

  test("asks for the first name when only the last name is filled in, even with a company", () => {
    expect(
      issuesOf(
        reservation({ lastName: "Nováková", company: "Deskohub s.r.o." })
      )
    ).toEqual([
      {
        path: ["firstName"],
        message: m["trainingReservation.validation.firstNameRequired"](),
      },
    ]);
  });

  test("requires a role once both a company and a full name are filled in", () => {
    const companyContact = {
      firstName: "Jana",
      lastName: "Nováková",
      company: "Deskohub s.r.o.",
    };

    expect(issuesOf(reservation({ ...companyContact, role: " " }))).toEqual([
      {
        path: ["role"],
        message:
          m["trainingReservation.validation.roleRequiredWhenBothFilled"](),
      },
    ]);
    expect(issuesOf(reservation({ ...companyContact, role: "HR" }))).toEqual(
      []
    );
  });

  test("normalizes the phone number of a valid reservation", () => {
    const result = reservationSchema.parse(
      reservation({ company: "Deskohub s.r.o." })
    );

    expect(result.phone).toBe("+420777123456");
  });
});
