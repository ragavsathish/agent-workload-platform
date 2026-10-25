import { inflateRawSync } from 'node:zlib';

export function zipEntry(archive: Buffer, name: string): Buffer {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Workspace artifact is not a ZIP archive');
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = archive.readUInt16LE(cursor + 10);
    const size = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const entryName = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP entry');
    const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26)
      + archive.readUInt16LE(localOffset + 28);
    const data = archive.subarray(dataStart, dataStart + size);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
    throw new Error(`Unsupported ZIP method ${method}`);
  }
  throw new Error(`Workspace artifact lacks ${name}`);
}
