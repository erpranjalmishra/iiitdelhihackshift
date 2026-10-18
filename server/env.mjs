// Loaded first by the server so .env values exist before other modules read process.env.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT, '.env');

try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // No .env yet — the app runs on the offline engine until a key is added.
}
