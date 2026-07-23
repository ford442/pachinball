import { describe, expect, it } from 'vitest'
import {
  estimateBackboxVideoBytes,
  formatBytes,
} from '../src/pwa/storage-quota'

describe('storage-quota', () => {
  it('estimates backbox video cache size from clip count', () => {
    expect(estimateBackboxVideoBytes(1)).toBe(8 * 1024 * 1024)
    expect(estimateBackboxVideoBytes(5)).toBe(40 * 1024 * 1024)
  })

  it('formats byte sizes for human-readable logs', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
