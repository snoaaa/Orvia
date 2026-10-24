/** Loads api/.env without overriding variables already set in the shell. */
export function loadEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: rely on the shell environment.
  }
}
