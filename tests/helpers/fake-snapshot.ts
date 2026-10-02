/** Hand-built v1 world snapshots for parser / gate tests that run without a bundle. */

/** A v1 blob with the words readSnapshotIds reads (layout: native/src/Snapshot.cpp). */
export function fakeSnapshot(opts: {
  hashHi: number
  hashLo: number
  ids: number[]
  version?: number
  hinges?: Array<{ id: number; bodyId: number; active?: boolean }>
  stepCount?: number
}): Uint8Array {
  const words: number[] = [0x4e534250, opts.version ?? 1, 0, opts.hashLo, opts.hashHi]
  for (let i = 0; i < 12; i++) words.push(0) // static counts
  words.push(opts.stepCount ?? 0, 0, 0) // step lo/hi, accumulator
  for (let i = 0; i < 10; i++) words.push(0) // params
  const nextId = Math.max(-1, ...opts.ids) + 1
  words.push(nextId, nextId)
  for (let id = 0; id < nextId; id++) words.push(opts.ids.indexOf(id), 0)
  words.push(opts.ids.length, ...opts.ids)
  for (let i = 0; i < opts.ids.length * 34; i++) words.push(0) // body columns
  const hinges = opts.hinges ?? []
  words.push(Math.max(-1, ...hinges.map((h) => h.id)) + 1, hinges.length)
  for (const h of hinges) {
    words.push(h.id, h.bodyId, h.active === false ? 0 : 1)
    for (let i = 0; i < 18; i++) words.push(0)
  }
  words[2] = words.length
  const out = new Uint8Array(words.length * 4)
  const view = new DataView(out.buffer)
  words.forEach((w, i) => view.setUint32(i * 4, w >>> 0, true))
  return out
}
