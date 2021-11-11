import { FileTree } from './filetree.js'
import { Repo } from './repo.js'
import { Commit } from './commit.js'
import { Blob, BlobChunk } from './blob.js'
import { hash, genId } from './lib/crypto.js'
import { BLOB_CHUNK_BYTE_LENGTH } from './lib/const.js'

export class BaseFilestore {
}

export class Staging extends BaseFilestore {
  fileTree: FileTree = new FileTree()
  blobs: Map<string, Buffer> = new Map()

  constructor (public repo: Repo) {
    super()
  }

  async getBlob (blobRef: string): Promise<Buffer|undefined> {
    const blob = this.blobs.get(blobRef)
    if (!blob) throw new BlobNotFoundError()
    return await Promise.resolve(blob)
  }

  list (path = '/') {
    return this.fileTree.list(path)
  }

  read (path: string): Promise<Buffer|undefined> {
    const blobRef = this.fileTree.read(path)
    if (blobRef) {
      return this.getBlob(blobRef)
    } else {
      return Promise.resolve(undefined)
    }
  }

  async write (path: string, blob: Buffer) {
    const blobRef = hash(blob)
    if (!this.blobs.has(blobRef)) {
      this.blobs.set(blobRef, blob)
    }
    this.fileTree.write(path, blobRef)
    return await Promise.resolve(undefined)
  }

  async delete (path: string) {
    this.fileTree.delete(path)
    return await Promise.resolve(undefined)
  }

  async generateCommit (message: string): Promise<Commit> {
    const head = await this.repo.getTree('main')
    return new Commit({
      id: genId(),
      parents: [head.data.commit].concat(head.data.conflicts || []),
      message,
      timestamp: new Date(),
      diff: this.fileTree.diff(FileTree.fromSerialized(head.data.files))
    })
  }

  async* generateBlobs (commit: Commit): AsyncGenerator<Blob|BlobChunk> {
    const items = commit.data.diff.added.concat(commit.data.diff.changed)
    for (const [path, hash] of items) {
      const blob = await this.getBlob(hash)
      if (!blob) continue

      // TODO: detect if the blob length is close to the chunk size and cheat to avoid small slices

      yield new Blob({
        hash,
        bytes: blob.length,
        length: Math.ceil(blob.length / BLOB_CHUNK_BYTE_LENGTH)
      })
      let i = 0
      while (i < blob.length) {
        yield new BlobChunk({value: blob.slice(i, i + BLOB_CHUNK_BYTE_LENGTH)})
        i += BLOB_CHUNK_BYTE_LENGTH
      }
    }
  }
}

export class BlobNotFoundError extends Error {
  httpCode = 500
  constructor (message?: string) {
    super(message || '')
    this.name = 'BlobNotFoundError'
  }
}
