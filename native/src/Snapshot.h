#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace pachinball {

/**
 * Versioned world snapshot (#422) — the solver state a replay needs to rewind
 * or fast-forward the C++ world bit-for-bit.
 *
 * Wire format: a flat run of little-endian 32-bit words (`float32` bit
 * patterns, `int32` / `uint32` values; 64-bit counters as lo, hi). The byte
 * order is written explicitly, so native and WASM builds emit identical bytes
 * for the same world (`npm run test:wasm-parity` compares them).
 *
 *   [0]  SNAPSHOT_MAGIC ('PBSN')
 *   [1]  SNAPSHOT_VERSION
 *   [2]  total word count (header included) — truncation guard
 *   [3]  static content hash lo   [4] hi   (FNV-1a 64, see staticContentHash)
 *   [5 .. 5+SNAPSHOT_STATIC_FAMILIES)  per-family static counts
 *   then: step counter, accumulator, world params, handle table, the full
 *   BodyStore SoA (poses, velocities, forces, mass/inertia, material, types,
 *   shapes, sleep flags + counters, group masks), hinges (angles are
 *   recovered from body rotation + rest pose, motor targets stored), pending
 *   kinematic-body targets, per-static group masks, mover poses/velocities,
 *   force-field vectors/enables, and the persistent contact manifold with
 *   its flush generation — so a restored world does not re-fire Enter for a
 *   pair that was already touching.
 *
 * Static geometry itself is NOT serialized: only its hash and counts. A
 * snapshot refuses to restore into a world whose static table was built
 * differently (`SnapshotStatus::StaticMismatch`) — rebuild the table, then
 * restore. Rigid bodies are replaced wholesale, public ids included.
 */
inline constexpr uint32_t SNAPSHOT_MAGIC   = 0x4E534250u; // "PBSN" as LE bytes
inline constexpr uint32_t SNAPSHOT_VERSION = 1u;

/**
 * Static families, in header order: planes, boxes, capsules, cylinders,
 * spheres, cones, pin fields, movers, sensors, meshes, mesh triangles,
 * force fields.
 */
inline constexpr int SNAPSHOT_STATIC_FAMILIES = 12;
inline constexpr int SNAPSHOT_HEADER_WORDS = 5 + SNAPSHOT_STATIC_FAMILIES;

enum class SnapshotStatus : int {
  Ok             = 0,
  BadMagic       = 1,
  BadVersion     = 2,
  Truncated      = 3,
  /** Static hash or counts differ: the table was built differently. Nothing restored. */
  StaticMismatch = 4,
  /** Well-formed header but inconsistent payload (bad counts, dangling handles). */
  Corrupt        = 5,
};

/** Append-only little-endian word writer. */
class SnapshotWriter {
public:
  void u32(uint32_t v);
  void i32(int32_t v) { u32(static_cast<uint32_t>(v)); }
  void f32(float v);
  void u64(uint64_t v) {
    u32(static_cast<uint32_t>(v & 0xFFFFFFFFu));
    u32(static_cast<uint32_t>(v >> 32));
  }
  /** Overwrite an already-written word (header back-patching). */
  void patch(std::size_t wordIndex, uint32_t v);
  std::size_t wordCount() const { return bytes_.size() / 4; }
  std::vector<uint8_t> take() { return std::move(bytes_); }

private:
  std::vector<uint8_t> bytes_;
};

/**
 * Bounds-checked little-endian word reader. A read past the end returns 0
 * and latches `failed()`, so decoders can read straight through and check
 * once at the end.
 */
class SnapshotReader {
public:
  SnapshotReader(const uint8_t* data, std::size_t size) : data_(data), size_(size) {}

  uint32_t u32();
  int32_t  i32() { return static_cast<int32_t>(u32()); }
  float    f32();
  uint64_t u64() {
    const uint64_t lo = u32();
    const uint64_t hi = u32();
    return lo | (hi << 32);
  }
  /**
   * Guard a count read from the blob before allocating for it: true when
   * `count` items of `wordsEach` words can still fit. Latches failure otherwise.
   */
  bool fits(uint32_t count, std::size_t wordsEach);
  std::size_t remainingWords() const { return (size_ - pos_) / 4; }
  bool failed() const { return failed_; }
  void fail() { failed_ = true; }

private:
  const uint8_t* data_;
  std::size_t    size_;
  std::size_t    pos_ = 0;
  bool           failed_ = false;
};

/** FNV-1a 64 over explicit little-endian words (never raw struct memory — padding). */
class SnapshotHasher {
public:
  void u32(uint32_t v);
  void i32(int32_t v) { u32(static_cast<uint32_t>(v)); }
  void f32(float v);
  uint64_t value() const { return h_; }

private:
  uint64_t h_ = 0xCBF29CE484222325ull;
};

} // namespace pachinball
