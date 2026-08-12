import AsyncStorage from "@react-native-async-storage/async-storage";

export interface DeviceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const deviceStorage: DeviceStorage = AsyncStorage;
