import bytes from 'bytes'

export const OP_COMMIT = 1
export const OP_BLOB = 2
export const OP_BLOB_CHUNK = 3
export const BLOB_CHUNK_BYTE_LENGTH = bytes('4mb')