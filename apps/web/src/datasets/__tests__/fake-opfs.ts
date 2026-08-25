/**
 * In-memory OPFS fakes for the #220 dataset store tests.
 *
 * Node (vitest) has no Origin Private File System, so these fakes implement
 * exactly the surface `browser/opfs-dataset.ts` touches
 * (getDirectoryHandle / getFileHandle / createWritable / getFile /
 * removeEntry) over in-memory bytes. `getFile()` returns a real `File`
 * (Node ≥ 20 global) so `slice`/`arrayBuffer` behave like the browser.
 */

export class FakeFileHandle {
  private bytes = new Uint8Array()

  constructor(public readonly name: string) {}

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this)
  }

  async getFile(): Promise<File> {
    return new File([this.bytes as unknown as BlobPart], this.name, { type: 'application/zip' })
  }

  get size(): number {
    return this.bytes.byteLength
  }

  setBytes(bytes: Uint8Array): void {
    this.bytes = bytes
  }
}

export class FakeWritable {
  constructor(private readonly file: FakeFileHandle) {}

  async write(data: Uint8Array): Promise<void> {
    this.file.setBytes(data)
  }

  async close(): Promise<void> {
    /* nothing to flush — bytes are stored on write */
  }
}

export class FakeDirectoryHandle {
  private children = new Map<string, FakeDirectoryHandle | FakeFileHandle>()

  constructor(public readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirectoryHandle> {
    const existing = this.children.get(name)
    if (existing) {
      if (existing instanceof FakeDirectoryHandle) return existing
      throw new Error(`TypeMismatchError: ${name} is a file`)
    }
    if (options?.create) {
      const dir = new FakeDirectoryHandle(name)
      this.children.set(name, dir)
      return dir
    }
    throw new Error(`NotFoundError: ${name}`)
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.children.get(name)
    if (existing) {
      if (existing instanceof FakeFileHandle) return existing
      throw new Error(`TypeMismatchError: ${name} is a directory`)
    }
    if (options?.create) {
      const file = new FakeFileHandle(name)
      this.children.set(name, file)
      return file
    }
    throw new Error(`NotFoundError: ${name}`)
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }): Promise<void> {
    if (!this.children.delete(name)) throw new Error(`NotFoundError: ${name}`)
  }
}

/** A fresh in-memory OPFS root (the `datasets/` dir is created on demand). */
export function makeFakeOpfsRoot(): FakeDirectoryHandle {
  return new FakeDirectoryHandle('<root>')
}