import { unpack, pack } from 'msgpackr'
// @ts-ignore no types available yet -prf
import crypto from 'hypercore-crypto'
// @ts-ignore no types available yet -prf
import Corestore from 'corestore'
import { BaseRepoCore } from './base.js'
import { Commit } from './commit.js'
import { Blob, BlobChunk } from './blob.js'
import { OP_COMMIT, OP_BLOB, OP_BLOB_CHUNK } from './lib/const.js'

export class RepoWriter extends BaseRepoCore {
  static createNew (store: Corestore) {
    const keyPair = crypto.keyPair()
    return new RepoWriter(store, keyPair.publicKey, keyPair.secretKey)
  }

  static load (store: Corestore, publicKey: string, secretKey?: string) {
    return new RepoWriter(
      store,
      Buffer.from(publicKey, 'hex'),
      secretKey ? Buffer.from(secretKey, 'hex') : undefined
    )
  }

  static packop (value: Commit|Blob|BlobChunk) {
    if (value instanceof Commit) {
      return pack({
        op: OP_COMMIT,
        ...value.data
      })
    } else if (value instanceof Blob) {
      return pack({
        op: OP_BLOB,
        ...value.data
      })
    } else if (value instanceof BlobChunk) {
      return pack({
        op: OP_BLOB_CHUNK,
        ...value.data
      })
    } else {
      throw new Error(`Can't pack unknown type ${typeof value}`)
    }
  }

  static unpackop (buf: Buffer): Commit|Blob|BlobChunk {
    const msg = unpack(buf)
    if (msg.op === OP_COMMIT) {
      return new Commit({
        id: msg.id,
        parents: msg.parents,
        message: msg.message,
        timestamp: msg.timestamp,
        diff: msg.diff
      })
    } else if (msg.op === OP_BLOB) {
      return new Blob({
        hash: msg.hash,
        bytes: msg.bytes,
        length: msg.length
      })
    } else if (msg.op === OP_BLOB_CHUNK) {
      return new BlobChunk({
        value: msg.value
      })
    } else {
      throw new Error(`Cant unpack unknown opcode ${msg.op}`)
    }
  }
}