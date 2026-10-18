// Self-signed HTTPS certificate covering this computer's LAN addresses, so phones on the
// same Wi-Fi can use their camera (browsers allow cameras only on HTTPS or localhost).
// Phones show a one-time certificate warning — tap "Advanced → Proceed".
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const certs = path.join(root, 'certs');
mkdirSync(certs, { recursive: true });

const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
const openssl = candidates.find((c) => {
  try { execFileSync(c, ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!openssl) {
  console.error('OpenSSL was not found. Install Git for Windows (it bundles OpenSSL) or OpenSSL, then run: npm run certs');
  process.exit(1);
}

const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');

execFileSync(openssl, [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
  '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem'),
  '-subj', '/CN=Nadi local', '-addext', `subjectAltName=${san}`,
], { stdio: 'ignore' });

if (!existsSync(path.join(certs, 'cert.pem'))) { console.error('Certificate generation failed.'); process.exit(1); }
console.log(`Created certs/cert.pem for ${san}`);
console.log('Restart Nadi (npm start). Phones on the same Wi-Fi: open https://<this-computer-ip>:3443');
