# Hyper-VCR (Version Controlled Repo)

A p2p version-controlled repo [Hypercore's new multiwriter Autobase](https://github.com/hypercore-protocol/autobase).

## TODOs

- [ ] Implement indexer _apply
- [ ] Workspace local blob storage
- [ ] Events / reactive APIs
- [ ] Tests
  - [ ] All operations
  - [ ] Conflict resolution
- [ ] Additional data structures
  - [ ] Tags (versions)
  - [ ] Comments / Annotations

## Implementation notes

### Hypercore schemas

The repo is an Autobase which uses oplog inputs and a Hyperbee for the index. All data is encoded using msgpack.

The Hyperbee index uses the following layout:

```
/_meta = Meta
/branches/{branch} = Branch
/commits/{branch}/{commit} = IndexedCommit
/blobs/{hash} = IndexedBlob

Meta {
  schema: 'vcr',
  writerKeys: Buffer[]
}
Branch {
  commit: string, // id of the commit that created this branch
  conflicts: string[], // ids currently-conflicting commits
  files: [
    // path        blob-ref (hash)
    ['/foo.txt', 'sha256-123ad..df'],
    ['/bar.txt', 'sha256-dkc22..12']
  ]
}
IndexedCommit {
  id: string, // random generated ID
  writer: Buffer, // key of the core that authored the commit
  parents: string[] // IDs of commits which preceded this commit
  branch: string // ID of the branch this commit is to
  message: string // a description of the commit
  timestamp: DateTime // local clock time of commit
  diff: {
    add: [[path: string, hash: string], ...],
    change: [[path: string, hash: string], ...],
    del: [path: string, ...]
  ]
}
IndexedBlob {
  writer: Buffer // key of the input core which contains this blob
  bytes: number // number of bytes in this blob
  start: number // starting seq number
  end: number // ending seq number
}
```

The oplogs include one of the following message types:

```
SetMeta {
  op: 1
  writerKeys: Buffer[]
}
Commit {
  op: 2
  id: string // random generated ID
  parents: string[] // IDs of commits which preceded this commit
  branch: string // ID of the branch this commit is to
  message: string // a description of the commit
  timestamp: DateTime // local clock time of commit
  diff: {
    add: [[path: string, hash: string], ...],
    change: [[path: string, hash: string], ...],
    del: [path: string, ...]
  ]
}
Blob {
  op: 3
  hash: string // hash of this blob
  bytes: number // number of bytes in this blob
  length: number // number of chunks in this blob (which will follow this op)
}
BlobChunk {
  op: 4
  value: Buffer // content
}
```

### Managing writers

Only the creator of the Repo maintains the Hyperbee index as a hypercore. The owner updates the `/_meta` entry to determine the current writers.

This is a temporary design until Autoboot lands.

### Detecting conflicts in commits

All commit operations have a random ID and list the parent commits by their ID. When the indexer handles a commit, it compares the listed parents to the current branch's "head commits". If one of the head commits is not included in the list of parents, the branch is put in conflict state. Conflict state is tracked by a list of commit IDs in the tree entry.