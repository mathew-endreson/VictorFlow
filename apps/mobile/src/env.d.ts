// Expo inlines EXPO_PUBLIC_* at build time; VF_LIVE_* are only read by the opt-in live integration test (Node).
declare const process: { env: { EXPO_PUBLIC_API_URL?: string; VF_LIVE_API?: string; VF_LIVE_PASSWORD?: string } };
