# DEAD Hyper-VCR (Version Controlled Repo)

A p2p version-controlled repo [Hypercore's new multiwriter Autobase](https://github.com/hypercore-protocol/autobase).

## Dead repo

This repo was created for [edword](https://github.com/atek-cloud/edword), a p2p text editor.

I began exploring VCR as a Git/VCS model for edword because I thought it might provide the most intuitive UX for multi-user collaboration. I eventually became convinced that the commit-style approach is actually *not* ideal for this use-case.

VCR is built on [Hypercore's Autobase](https://github.com/hypercore-protocol/autobase). The thing to understand about Autobase is that it is offline-first (not realtime) and automatically merging. This leads to some subtle challenges.

- *Offline-first, not realtime.* Realtime collaboration is stuff like Google Docs and HackMD. There are live connections between users. You may experience small disconnects and frequent conflicts due to the network, but the realtime model can enforce a connectivity window. If the user disconnects for 10 minutes, you might very well put their copy in a "sorry, can't merge" state and have the user manually copy over their changes to the latest buffer. Offline-first has no such window. A user could disconnect for ten years and still expect a merge. There's obviously ways you can tweak the model to address this, but my general thinking is that no connectivity window means it's hard to adopt the techniques of realtime collaboration as they're typically used.
- *Automatically merging*. Git is a manually merged VCS. Every node maintains a local state and lets the user choose when to push and pull their commits. Autobase is automatically merging. This means it's like a version of Git which automatically pushes and pulls all the time. This means two things: 1, you never know when your local copy of a branch might enter into conflict, and 2, you can't stop a devices that's been offline for ten years from pushing when it comes online.

None of these problems are insurmountable! In fact, [Fossil SCM supports autosync](https://fossil-scm.org/home/doc/trunk/www/concepts.wiki#workflow) as one of its modes. I'm extremely confident a VCS can be implemented on Autobase.

However: as a backend for edword and other similar applications (notes apps, wikis, whiteboards) these problems make a VCS's commit semantics less useful than I first imagined. I think instead the UX of SyncThing and Dropbox, which just allow per-file conflict states to bubble up to the user, will be a better approach. Add in per-file histories with the ability to restore and I think you have all you need. I also believe that an optional "CRDT mode" for files could be worth exploring, as some applications (like edword) could leverage that to automatically merge conflicts. Again: we'll see. The offline-first constraint can really make it hard to preserve intention with edits.

Moving forward, I think the ideas in this repo should be split into separate data structures. The first version will be the one I pursue for edword, and will generally just drop the commit semantics. The second version, a VCS, could potentially implement Git atop Autobase. In that model, it's worth considering if the AutobasedGit could act like a "magical remote," leaving Git's local tree state as is. Doing so would preserve the manual push/pull behaviors that users expect.

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
  - [ ] Per-file CRDTs for improved merging

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