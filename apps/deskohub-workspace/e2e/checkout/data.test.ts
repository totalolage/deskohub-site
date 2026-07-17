import { afterEach, expect, setSystemTime, test } from "bun:test";
import { makeCoworkCheckoutData } from "./data";

afterEach(() => setSystemTime());

test("does not reuse checkout phone numbers in later monthly runs", () => {
  const makePhoneSet = (now: string) => {
    setSystemTime(new Date(now));

    return new Set(
      Array.from(
        { length: 100 },
        () =>
          makeCoworkCheckoutData("https://workspace.example.com", "2099-09-01")
            .phone
      )
    );
  };

  const julyPhones = makePhoneSet("2099-07-17T09:48:00.000Z");
  const augustPhones = makePhoneSet("2099-08-17T09:48:00.000Z");

  expect(julyPhones.size).toBe(100);
  expect(augustPhones.size).toBe(100);
  expect(julyPhones.intersection(augustPhones).size).toBe(0);
});
