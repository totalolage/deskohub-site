import { describe, expect, mock, test } from "bun:test";
import type { ConsentCategory } from "@/features/cookie-consent";
import {
  type ConsentPreferences,
  toggleConsentPreference,
} from "./consent-preference-toggle";

const savedPreferences: ConsentPreferences = {
  necessary: true,
  analytics: false,
  marketing: true,
  preferences: false,
};

const toggle = (category: ConsentCategory) => {
  let preferences = savedPreferences;
  const actions = {
    preferences: savedPreferences,
    setPreferences: mock(
      (update: (previous: ConsentPreferences) => ConsentPreferences) => {
        preferences = update(preferences);
      }
    ),
    acceptCategory: mock((_category: ConsentCategory) => {}),
    rejectCategory: mock((_category: ConsentCategory) => {}),
  };
  toggleConsentPreference(category, actions);
  return { ...actions, preferences };
};

describe("toggleConsentPreference", () => {
  test("accepts a category that was off", () => {
    const result = toggle("analytics");

    expect(result.preferences).toEqual({
      ...savedPreferences,
      analytics: true,
    });
    expect(result.acceptCategory).toHaveBeenCalledWith("analytics");
    expect(result.rejectCategory).not.toHaveBeenCalled();
  });

  test("rejects a category that was on", () => {
    const result = toggle("marketing");

    expect(result.preferences).toEqual({
      ...savedPreferences,
      marketing: false,
    });
    expect(result.rejectCategory).toHaveBeenCalledWith("marketing");
    expect(result.acceptCategory).not.toHaveBeenCalled();
  });

  test("never toggles necessary cookies", () => {
    const result = toggle("necessary");

    expect(result.preferences).toBe(savedPreferences);
    expect(result.setPreferences).not.toHaveBeenCalled();
    expect(result.acceptCategory).not.toHaveBeenCalled();
    expect(result.rejectCategory).not.toHaveBeenCalled();
  });
});
