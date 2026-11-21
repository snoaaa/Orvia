import Constants from "expo-constants";

const DEFAULT_API_PORT = 8084;

export function getApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  // Over USB or hotspot LAN, reuse the Metro packager host so physical devices reach the local API.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (
      Constants as unknown as {
        manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
      }
    ).manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (
      host &&
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      !host.endsWith(".exp.direct")
    ) {
      return `http://${host}:${DEFAULT_API_PORT}`;
    }
  }

  return `http://localhost:${DEFAULT_API_PORT}`;
}

export function getEnvAccessToken(): string | null {
  return process.env.EXPO_PUBLIC_ACCESS_TOKEN?.trim() || null;
}

export function getEnvDevEmail(): string | null {
  return process.env.EXPO_PUBLIC_DEV_EMAIL?.trim() || null;
}
