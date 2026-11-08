import { prepareAuthLocation } from "./auth-location";

// Imported by the app entry before Expo Router, which snapshots the address
// bar when it loads.
prepareAuthLocation();
