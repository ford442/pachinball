/**
 * Little-endian word codec + FNV-1a hasher for world snapshots (#431) —
 * SnapshotWriter / SnapshotReader / SnapshotHasher from Snapshot.h. Bytes are
 * assembled with shifts, never by casting host memory, so the wire format is
 * the same on every build (native x86-64, WASM).
 */
#include "Snapshot.h"

#include <cstring>

namespace pachinball {

void SnapshotWriter::u32(uint32_t v) {
  bytes_.push_back(static_cast<uint8_t>(v));
  bytes_.push_back(static_cast<uint8_t>(v >> 8));
  bytes_.push_back(static_cast<uint8_t>(v >> 16));
  bytes_.push_back(static_cast<uint8_t>(v >> 24));
}

void SnapshotWriter::f32(float v) {
  uint32_t bits;
  std::memcpy(&bits, &v, sizeof bits);
  u32(bits);
}

void SnapshotWriter::patch(std::size_t wordIndex, uint32_t v) {
  const std::size_t at = wordIndex * 4;
  if (at + 4 > bytes_.size()) return;
  bytes_[at]     = static_cast<uint8_t>(v);
  bytes_[at + 1] = static_cast<uint8_t>(v >> 8);
  bytes_[at + 2] = static_cast<uint8_t>(v >> 16);
  bytes_[at + 3] = static_cast<uint8_t>(v >> 24);
}

uint32_t SnapshotReader::u32() {
  if (failed_ || pos_ + 4 > size_) {
    failed_ = true;
    return 0;
  }
  const uint8_t* p = data_ + pos_;
  pos_ += 4;
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

float SnapshotReader::f32() {
  const uint32_t bits = u32();
  float v;
  std::memcpy(&v, &bits, sizeof v);
  return v;
}

bool SnapshotReader::fits(uint32_t count, std::size_t wordsEach) {
  if (failed_) return false;
  if (wordsEach > 0 && static_cast<std::size_t>(count) > remainingWords() / wordsEach) {
    failed_ = true;
    return false;
  }
  return true;
}

void SnapshotHasher::u32(uint32_t v) {
  for (int i = 0; i < 4; ++i) {
    h_ ^= static_cast<uint8_t>(v >> (8 * i));
    h_ *= 0x100000001B3ull;
  }
}

void SnapshotHasher::f32(float v) {
  uint32_t bits;
  std::memcpy(&bits, &v, sizeof bits);
  u32(bits);
}

} // namespace pachinball
