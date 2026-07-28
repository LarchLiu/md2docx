import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const testDir = __dirname;
export const outDir = path.join(testDir, 'out');

export function ensureOutDir() {
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

export function makeOutSubdir(prefix) {
  ensureOutDir();
  // `mkdtempSync` appends random suffix; keep outputs for inspection.
  return fs.mkdtempSync(path.join(outDir, prefix));
}

export function makeFrontMatterDoc(frontMatterYaml, body) {
  const fm = String(frontMatterYaml ?? '').trim();
  const b = String(body ?? '').trim();
  if (!fm) return `${b}\n`;
  return `---\n${fm}\n---\n\n${b}\n`;
}

export function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export async function withTempDir(prefix, fn) {
  const dir = makeOutSubdir(prefix);
  return await fn(dir);
}

export function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
}

export function isJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 3 && buf.slice(0, 3).toString('hex') === 'ffd8ff';
}

export function isWebp(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  );
}

function getZipEntries(buffer) {
  const endSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  let endOffset = -1;

  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === endSignature) {
      endOffset = i;
      break;
    }
  }
  assertZip(endOffset >= 0, 'ZIP end-of-central-directory record not found');

  const entries = new Map();
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);

  for (let i = 0; i < entryCount; i++) {
    assertZip(buffer.readUInt32LE(offset) === centralSignature, 'Invalid ZIP central directory');
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    entries.set(name, { compression, compressedSize, localOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function assertZip(condition, message) {
  if (!condition) throw new Error(message);
}

export function listZipEntries(buffer) {
  return [...getZipEntries(buffer).keys()];
}

export function readZipEntry(buffer, name) {
  const entry = getZipEntries(buffer).get(name);
  assertZip(entry, `ZIP entry not found: ${name}`);
  assertZip(buffer.readUInt32LE(entry.localOffset) === 0x04034b50, `Invalid ZIP local header: ${name}`);

  const fileNameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const dataOffset = entry.localOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.compression}: ${name}`);
}

let _browserAvailable;

export async function canUseBrowser(api) {
  if (typeof _browserAvailable === 'boolean') return _browserAvailable;

  try {
    // Small, deterministic render that forces Puppeteer usage.
    await api.convert('# browser-check', {
      format: 'png',
      diagramMode: 'none',
      image: {
        split: false,
        viewport: { width: 400, height: 300, deviceScaleFactor: 1 },
      },
    });
    _browserAvailable = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Failed to launch the browser process')) {
      _browserAvailable = false;
    } else {
      throw e;
    }
  }

  return _browserAvailable;
}
