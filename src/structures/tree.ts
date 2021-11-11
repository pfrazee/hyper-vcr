import { SerializedFileTree } from './filetree.js'

export interface TreeData {
  commit: string
  conflicts: string[]
  files: SerializedFileTree
}

export class Tree {
  constructor (public data: TreeData) {
    // TODO validate
  }
}