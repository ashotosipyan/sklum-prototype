import { Platform } from 'react-native';

/**
 * The iOS simulator reaches the host on localhost; the Android emulator needs
 * 10.0.2.2. A physical device needs the LAN IP of the machine running the
 * backend — set the EXPO_PUBLIC_* variables for that.
 */
const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const BFF_URL = process.env.EXPO_PUBLIC_BFF_URL ?? `http://${host}:4100`;
export const COLLECTOR_URL = process.env.EXPO_PUBLIC_COLLECTOR_URL ?? `http://${host}:4200`;
export const APP_VERSION = '0.1.0';

/** The prototype has no real auth. Signing in means becoming this customer. */
export const DEMO_CUSTOMER_ID = 'cust_1';
