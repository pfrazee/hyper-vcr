// @ts-ignore no types available yet -prf
import crypto from 'hypercore-crypto'
// @ts-ignore no types available yet -prf
import Corestore from 'corestore'
// @ts-ignore no types available yet -prf
import Hypercore from 'hypercore'
// @ts-ignore no types available yet -prf
import Autobase from 'autobase'
// @ts-ignore no types available yet -prf
import Hyperbee from 'hyperbee'
// @ts-ignore no types available yet -prf
import HyperbeeMessages from 'hyperbee/lib/messages.js'
import { BaseRepoCore } from './cores/base.js'
import { RepoWriter, SetMeta } from './cores/oplog.js'
import { Tree } from './structures/tree.js'
import { Commit } from './structures/commit.js'
import { IndexedBlob, BlobChunk } from './structures/blob.js'
import { Staging } from './staging.js'
import lock from './lib/lock.js'

export interface RepoMeta {
  schema: string
  writerKeys: string[]
}

export interface RepoOpts {
  writers?: RepoWriter[]
  index: RepoIndex
}

export interface WriteOpts {
  writer?: Buffer|Hypercore
  prefix?: string
}

export class RepoIndex extends BaseRepoCore {
  static createNew (store: Corestore) {
    const keyPair = crypto.keyPair()
    return new RepoIndex(store, keyPair.publicKey, keyPair.secretKey)
  }

  static load (store: Corestore, publicKey: string, secretKey?: string) {
    return new RepoIndex(
      store,
      Buffer.from(publicKey, 'hex'),
      secretKey ? Buffer.from(secretKey, 'hex') : undefined
    )
  }
}

export class Repo {
  autobase: Autobase
  indexBee: Hyperbee
  meta: RepoMeta|undefined
  writers: RepoWriter[]
  index: RepoIndex
  constructor (public store: Corestore, {writers, index}: RepoOpts) {
    this.writers = writers || []
    this.index = index || undefined
    const inputs = this.writers.map(w => w.core)
    const defaultInput = inputs.find(core => core.writable)
    this.autobase = new Autobase(inputs, {indexes: index ? [index.core] : [], input: defaultInput})

    const indexCore = this.autobase.createRebasedIndex({
      unwrap: true,
      apply: this._apply.bind(this)
    })
    this.indexBee = new Hyperbee(indexCore, {
      extension: false,
      keyEncoding: 'utf-8',
      valueEncoding: 'binary'
    })
  }

  static async createNew (store: Corestore) {
    const repo = new Repo(store, {
      writers: [RepoWriter.createNew(store)],
      index: RepoIndex.createNew(store)
    })
    await repo.ready()
    await repo.persistMeta()
    return repo
  }

  static async load (store: Corestore, publicKey: string) {
    const repo = new Repo(store, {
      writers: [],
      index: RepoIndex.load(store, publicKey)
    })
    await repo.ready()
    await repo.loadFromMeta()
    await repo.watchMeta()
    return repo
  }

  async ready () {
    await this.autobase.ready()
    await this.indexBee.ready()
  }

  get key () {
    return this.index.publicKey
  }

  get writable () {
    return !!this.autobase.inputs.find((core: Hypercore) => core.writable)
  }

  get isOwner () {
    return this.index.writable
  }

  watchMeta () {
    this.index.core.on('append', () => {
      // TODO can we make this less stupid?
      this.loadFromMeta()
    })
  }

  async loadFromMeta () {
    const meta = (await this.indexBee.get('_meta'))?.value || {schema: 'vcr', writerKeys: []}
    meta.writerKeys = meta.writerKeys.map((buf: Buffer) => buf.toString('hex'))
    
    const release = await lock(`loadFromMeta:${this.key.toString('hex')}`)
    try {
      this.meta = meta
      for (const key of meta.writerKeys) {
        if (!this.writers.find(w => w.publicKey.toString('hex') === key)) {
          await this.addWriter(key)
        }
      }
      for (const w of this.writers) {
        if (!meta.writerKeys.includes(w.publicKey.toString('hex'))) {
          await this.removeWriter(w.publicKey)
        }
      }
    } finally {
      release()
    }
  }

  async persistMeta () {
    if (!this.isOwner) return
    this.meta = {schema: 'vcr', writerKeys: this.writers.map(w => w.publicKey.toString('hex'))}
    await this.putMeta(this.writers.map(w => w.publicKey))
  }

  serialize () {
    return {
      key: this.key.toString('hex'),
      writers: this.writers.map(w => w.serialize()),
      index: this.index.serialize()
    }
  }

  toJSON () {
    return {
      key: this.key.toString('hex'),
      writable: this.writable,
      writers: this.writers.map(w => w.toJSON())
    }
  }

  async createWriter () {
    const writer = RepoWriter.createNew(this.store)
    await writer.core.ready()
    this.writers.push(writer)
    this.autobase.addInput(writer.core)
    await this.persistMeta()
    return writer
  }

  async addWriter (publicKey: string) {
    const writer = RepoWriter.load(this.store, publicKey)
    await writer.core.ready()
    this.writers.push(writer)
    this.autobase.addInput(writer.core)
    await this.persistMeta()
    return writer
  }

  async removeWriter (publicKey: string|Buffer) {
    publicKey = (Buffer.isBuffer(publicKey)) ? publicKey : Buffer.from(publicKey, 'hex')
    const i = this.writers.findIndex(w => w.publicKey.equals(publicKey as Buffer))
    if (i === -1) throw new Error('Writer not found')
    this.autobase.removeInput(this.writers[i].core)
    this.writers.splice(i, 1)
    await this.persistMeta()
  }

  async getTree (treeId: string): Promise<Tree> {
    const entry = await this.indexBee.sub('trees').get(treeId)
    if (entry) return new Tree(entry.value)
    return new Tree({commit: '', conflicts: [], files: []})
  }

  async getCommit (treeId: string, commitId: string): Promise<Commit> {
    const entry = await this.indexBee.sub('commits').sub(treeId).get(commitId)
    if (entry) return new Commit(entry.value)
    throw new Error(`Commit not found: ${treeId}/${commitId}`)
  }

  async getBlobInfo (hash: string): Promise<IndexedBlob> {
    const entry = await this.indexBee.sub('blobs').get(hash)
    if (entry) return new IndexedBlob(entry.value)
    throw new Error(`Blob not found: ${hash}`)
  }

  async* createBlobReadIterator (info: IndexedBlob): AsyncGenerator<Buffer> {
    const writer = this.writers.find(w => w.publicKey.equals(info.data.writer)) 
    if (!writer) throw new Error(`Blob writer not found, key=${info.data.writer.toString('hex')}`)
    for (let i = info.data.start; i <= info.data.end; i++) {
      const op = await RepoWriter.unpackop(await writer.core.get(i))
      if (op instanceof BlobChunk) {
        yield op.data.value
      } else {
        throw new Error(`Invalid chunk`)
      }
    }
  }

  async putMeta (writerKeys: Buffer[], opts?: WriteOpts) {
    const writer = getWriterCore(this, opts)
    const release = await lock(`write:${this.key.toString('hex')}`)
    try {
      await this.autobase.append(RepoWriter.packop(new SetMeta({schema: 'vcr', writerKeys})), null, writer)
    } finally {
      release()
    }
  }

  async commit (staging: Staging, message: string, opts?: WriteOpts) {
    const writer = getWriterCore(this, opts)
    const release = await lock(`write:${this.key.toString('hex')}`)
    try {
      const c = await staging.generateCommit(message)
      await this.autobase.append(RepoWriter.packop(c), null, writer)
      for await (const op of staging.generateBlobs(c)) {
        await this.autobase.append(RepoWriter.packop(op), null, writer)
      }
    } finally {
      release()
    }
  }

  async _apply (batch: any[], clocks: any) {
    if (this.indexBee._feed.length === 0) {
      // HACK
      // when the indexBee is using the in-memory rebased core
      // (because it doesnt have one of its own, and is relying on a remote index)
      // it doesn't correctly write its header
      // so we do it here
      // -prf
      await this.indexBee._feed.append(HyperbeeMessages.Header.encode({
        protocol: 'hyperbee'
      }))
    }

    const b = this.indexBee.batch({ update: false })
    for (const node of batch) {
      let op = undefined
      try {
        op = JSON.parse(node.value)
      } catch (e) {
        // skip: not an op
        console.error('Warning: not an op', node.value, e)
        continue
      }

      // console.debug('OP', op)
      if (!op.op) {
        // skip: not an op
        console.error('Warning: not an op', op)
        continue
      }

      // console.log('handling', op)

      if (op.key && op.op === 'del') {
        await b.del(op.key)
      } else if (op.key && op.op === 'put') {
        await b.put(op.key, op.value)
      }
    }
    await b.flush()
  }
}

function getWriterCore (repo: Repo, opts?: WriteOpts) {
  let writer
  if (opts?.writer) {
    if (opts.writer instanceof RepoWriter) {
      writer = repo.writers.find(w => w === opts.writer)
    } else if (Buffer.isBuffer(opts.writer)) {
      writer = repo.writers.find(w => w.publicKey.equals(opts.writer)) 
    }
  } else {
    writer = repo.writers.find(w => w.core === repo.autobase.defaultInput) || repo.writers.find(w => w.writable)
  }
  if (!writer) {
    throw new Error(`Not a writer: ${opts?.writer}`)
  }
  if (!writer.writable) {
    throw new Error(`Not writable: ${opts?.writer}`)
  }
  return writer.core
}
