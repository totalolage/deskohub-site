// Simple feature detection based on environment
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

// Check if external services have API keys
const hasDotyposKey = Boolean(process.env.DOTYPOS_API_KEY);
const hasEmailKey = Boolean(process.env.EMAIL_API_KEY);

export const effectFeatures = {
  // External service availability
  dotyposEnabled: hasDotyposKey,
  emailEnabled: hasEmailKey,

  // Environment checks
  isProduction,
  isDevelopment: NODE_ENV === "development",
  isTest: NODE_ENV === "test",
} as const;
