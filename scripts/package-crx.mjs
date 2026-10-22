import { findBrowserExecutable } from './lib/browser-path.js';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createHash, verify, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const keyPath = resolve(process.env.CHRONTAB_SIGNING_KEY || '.signing/chrontab.pem');
await mkdir('.signing', { recursive: true });
await mkdir('artifacts', { recursive: true });
try {
  await access(keyPath);
} catch (error) {
  if (error.code !== 'ENOENT' || process.env.CHRONTAB_SIGNING_KEY) {
    throw error;
  }
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });
  await writeFile(keyPath, privateKey, { flag: 'wx', mode: 0o600 });
  console.log(
    'Created a local signing key in .signing/. Keep it backed up privately for future CRX versions.',
  );
}
const browser = findBrowserExecutable();
if (!browser) {
  throw new Error('Set CHRONTAB_BROWSER to a Chrome/Chromium executable before packaging.');
}
execFileSync(
  browser,
  [
    '--pack-extension=' + resolve('dist'),
    '--pack-extension-key=' + keyPath,
    '--user-data-dir=' + resolve('artifacts/crx-pack-profile'),
    '--no-message-box',
    '--no-first-run',
  ],
  { windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] },
);
const bytes = await readFile('dist.crx');
if (bytes.toString('ascii', 0, 4) !== 'Cr24' || bytes.readUInt32LE(4) !== 3) {
  throw new Error('The browser did not produce a CRX3 package.');
}
const headerLength = bytes.readUInt32LE(8),
  header = bytes.subarray(12, 12 + headerLength),
  zip = bytes.subarray(12 + headerLength);
function fields(buffer) {
  let at = 0;
  const result = [];
  const varint = () => {
    let value = 0,
      shift = 0,
      part;
    do {
      if (at >= buffer.length || shift > 49) {
        throw new Error('Invalid CRX protobuf.');
      }
      part = buffer[at++];
      value += (part & 127) * 2 ** shift;
      shift += 7;
    } while (part & 128);
    return value;
  };
  while (at < buffer.length) {
    const tag = varint(),
      wire = tag & 7;
    if (wire !== 2) {
      throw new Error('Unexpected CRX protobuf wire type.');
    }
    const length = varint();
    if (at + length > buffer.length) {
      throw new Error('Invalid CRX header length.');
    }
    result.push({ id: tag >> 3, bytes: buffer.subarray(at, at + length) });
    at += length;
  }
  return result;
}
const entries = fields(header),
  proof = fields(entries.find((f) => f.id === 2)?.bytes || Buffer.alloc(0));
const publicKey = proof.find((f) => f.id === 1)?.bytes,
  signature = proof.find((f) => f.id === 2)?.bytes,
  signed = entries.find((f) => f.id === 10000)?.bytes;
if (!publicKey || !signature || !signed) {
  throw new Error('CRX signing proof is missing.');
}
const length = Buffer.alloc(4);
length.writeUInt32LE(signed.length);
const data = Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signed, zip]);
if (
  !verify(
    'sha256',
    data,
    createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
    signature,
  )
) {
  throw new Error('CRX signature verification failed.');
}
const idBytes = createHash('sha256').update(publicKey).digest().subarray(0, 16),
  signedId = fields(signed).find((f) => f.id === 1)?.bytes;
if (!signedId?.equals(idBytes)) {
  throw new Error('CRX identity verification failed.');
}
const extensionId = idBytes
  .toString('hex')
  .replace(/[0-9a-f]/g, (d) => String.fromCharCode(97 + parseInt(d, 16)));
function zipEntry(name) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) {
    end--;
  }
  if (end < 0) {
    throw new Error('Invalid embedded ZIP.');
  }
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) {
      throw new Error('Invalid ZIP directory.');
    }
    const method = zip.readUInt16LE(at + 10),
      size = zip.readUInt32LE(at + 20),
      nameLength = zip.readUInt16LE(at + 28),
      extra = zip.readUInt16LE(at + 30),
      comment = zip.readUInt16LE(at + 32),
      offset = zip.readUInt32LE(at + 42);
    const filename = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (filename === name) {
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28),
        compressed = zip.subarray(start, start + size);
      if (method !== 0 && method !== 8) {
        throw new Error('Unsupported ZIP compression.');
      }
      return method === 8 ? inflateRawSync(compressed) : compressed;
    }
    at += 46 + nameLength + extra + comment;
  }
  throw new Error('Missing embedded manifest.');
}
const packedManifest = JSON.parse(zipEntry('manifest.json'));
if (packedManifest.version !== manifest.version || packedManifest.name !== manifest.name) {
  throw new Error('Packaged manifest does not match the build.');
}
const output = 'artifacts/Chrontab-' + manifest.version + '.crx';
await copyFile('dist.crx', output);
const info = {
  file: output,
  version: manifest.version,
  extensionId,
  format: 'CRX3',
  signatureVerified: true,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
await writeFile('artifacts/CRX-info.json', JSON.stringify(info, null, 2) + '\n');
const files = ['Chrontab-' + manifest.version + '.zip', 'Chrontab-' + manifest.version + '.crx'];
const sums = await Promise.all(
  files.map(
    async (name) =>
      createHash('sha256')
        .update(await readFile('artifacts/' + name))
        .digest('hex') +
      '  ' +
      name,
  ),
);
await writeFile('artifacts/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(JSON.stringify(info, null, 2));
