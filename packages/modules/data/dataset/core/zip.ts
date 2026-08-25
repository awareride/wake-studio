/**
 * Dataset module — canonical archive readers (ADR-045, #220).
 *
 * Pure zip inspection on top of the canonical `wake-studio-dataset.zip` layout
 * produced by `assembleDatasetZip`: list the `audio/<label>/<file>.wav`
 * entries and extract ONE entry without decompressing the whole archive (read
 * the central directory at the tail, slice the one local entry, inflate with
 * fflate). This is what the "per-clip random access" listenability rule of
 * `docs/modules/data-sources.md` §8.3 is built on — memory stays bounded to a
 * single clip, so large datasets can be auditioned without an unpack.
 *
 * The reader supports both whole-archive convenience paths (list/extract on a
 * `Uint8Array` — used by import flows and tests) and file-slice paths (bounded
 * reads off an OPFS `File` — used by the browser listener): find the tail
 * (EOCD), parse the central directory, then slice + inflate a single local
 * entry.
 */

import { inflateSync } from 'fflate'

/** One entry from the central directory. */
export interface ZipEntryInfo {
  /** Full entry name as stored, e.g. `audio/hey_studio/0001.wav`. */
  name: string
  /** Compression method: 0 = stored, 8 = deflate. */
  method: number
  /** Absolute byte offset of the local file header in the archive. */
  localHeaderOffset: number
  compressedSize: number
  uncompressedSize: number
}

/** The End-of-Central-Directory record (absolute offsets). */
export interface ZipEndRecord {
  cdOffset: number
  cdSize: number
  totalEntries: number
}

/** Largest possible EOCD comment, so the tail scan never needs more bytes. */
export const ZIP_EOCD_MAX_COMMENT = 65535
const EOCD_MIN_LEN = 22
const EOCD_SIG = 0x06054b50
const CD_ENTRY_SIG = 0x02014b50
const LOCAL_HDR_SIG = 0x04034b50
const LOCAL_HDR_MIN_LEN = 30

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

const textDecoder = new TextDecoder('utf-8')

/**
 * Locate the EOCD in a tail slice of the archive. `tail` must start within the
 * last `EOCD_MIN_LEN + ZIP_EOCD_MAX_COMMENT` bytes (callers passing an exact
 * tail read it as `file.slice(size - (22 + 65535))`; whole-archive callers pass
 * the archive with its true start offset). Returns the EOCD record with
 * absolute offsets, or throws on an invalid/short archive.
 */
export function findZipEnd(tail: Uint8Array): ZipEndRecord {
  if (tail.length < EOCD_MIN_LEN) throw new Error('Not a valid zip: too short to hold an end record.')
  // The EOCD signature sits within the last 22 + comment bytes of the file.
  for (let i = tail.length - EOCD_MIN_LEN; i >= 0; i--) {
    if (u32(tail, i) === EOCD_SIG) {
      return {
        cdOffset: u32(tail, i + 16),
        cdSize: u32(tail, i + 12),
        totalEntries: u16(tail, i + 10),
      }
    }
  }
  throw new Error('Not a valid zip: no End-Of-Central-Directory record found.')
}

/**
 * Parse `count` central-directory entries from a byte slice that begins at the
 * central directory start. Entries carry their own absolute `localHeaderOffset`
 * (relative to the whole archive), so the caller must only hand over a slice
 * long enough to cover all entries.
 */
export function parseCentralDirectory(bytes: Uint8Array, count: number): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== CD_ENTRY_SIG) throw new Error('Invalid zip: bad central-directory entry signature.')
    const method = u16(bytes, p + 10)
    const compressedSize = u32(bytes, p + 20)
    const uncompressedSize = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28)
    const extraLen = u16(bytes, p + 30)
    const commentLen = u16(bytes, p + 32)
    const localHeaderOffset = u32(bytes, p + 42)
    const name = textDecoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    entries.push({ name, method, localHeaderOffset, compressedSize, uncompressedSize })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** List every entry of an in-memory archive. */
export function listZipEntries(archive: Uint8Array): ZipEntryInfo[] {
  const end = findZipEnd(archive)
  const cd = archive.subarray(end.cdOffset, end.cdOffset + end.cdSize)
  return parseCentralDirectory(cd, end.totalEntries)
}

/**
 * Inflate the single entry whose LOCAL FILE HEADER is the first byte of
 * `bytes` (i.e. `archive.slice(entry.localHeaderOffset)`). The local header
 * carries the authoritative method + sizes, so this works on an exact slice —
 * no central-directory access needed at extract time.
 */
export function extractZipEntrySlice(bytes: Uint8Array): Uint8Array {
  if (bytes.length < LOCAL_HDR_MIN_LEN || u32(bytes, 0) !== LOCAL_HDR_SIG) {
    throw new Error('Invalid zip: bad local file header.')
  }
  const method = u16(bytes, 8)
  const compressedSize = u32(bytes, 18)
  const nameLen = u16(bytes, 26)
  const extraLen = u16(bytes, 28)
  const dataStart = LOCAL_HDR_MIN_LEN + nameLen + extraLen
  const data = bytes.subarray(dataStart, dataStart + compressedSize)
  if (method === 0) return new Uint8Array(data)
  if (method === 8) {
    try {
      return inflateSync(data)
    } catch {
      throw new Error('Invalid zip: could not inflate the entry (corrupt deflate data?)')
    }
  }
  throw new Error(`Invalid zip: unsupported compression method ${method} (only stored/deflate are supported).`)
}

/** Inflate one named entry out of an in-memory archive (undefined when absent). */
export function extractZipEntry(archive: Uint8Array, name: string): Uint8Array | undefined {
  const entry = listZipEntries(archive).find((e) => e.name === name)
  if (!entry) return undefined
  return extractZipEntrySlice(archive.subarray(entry.localHeaderOffset))
}