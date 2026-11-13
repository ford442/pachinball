#pragma once

/**
 * Shared pieces of the libFuzzer targets (#520 §5): an input reader, the
 * invariant failure hook, and a table builder that reproduces any snapshot's
 * per-family static counts so a real tape's frame-0 blob decodes past the
 * static-hash check.
 *
 * Build and run: `npm run fuzz` (scripts/run-fuzzers.mjs; clang + libFuzzer,
 * ASan + UBSan). Targets: fuzz_snapshot_restore.cpp, fuzz_command_stream.cpp.
 */

#include "PhysicsWorld.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <vector>

namespace pachinball::fuzz {

inline constexpr float FIXED_DT = 1.f / 60.f;

/** Report a broken invariant: libFuzzer saves the input that reached it. */
[[noreturn]] inline void fail(const char* what) {
  std::fprintf(stderr, "pachinball fuzz invariant broken: %s\n", what);
  std::abort();
}

/** Reads the fuzzer input front to back; past the end every read is 0. */
class ByteReader {
public:
  ByteReader(const uint8_t* data, std::size_t size) : data_(data), size_(size) {}

  [[nodiscard]] bool done() const { return pos_ >= size_; }

  uint8_t u8() { return pos_ < size_ ? data_[pos_++] : 0; }
  uint16_t u16() {
    const auto lo = static_cast<uint16_t>(u8());
    return static_cast<uint16_t>(lo | static_cast<uint16_t>(u8() << 8));
  }
  uint32_t u32() {
    const uint32_t lo = u16();
    return lo | (static_cast<uint32_t>(u16()) << 16);
  }
  bool flag() { return (u8() & 1u) != 0; }

  /** Any float bit pattern: NaN, ±inf, denormals, 3e38. */
  float raw() {
    const uint32_t bits = u32();
    float f = 0.f;
    std::memcpy(&f, &bits, sizeof f);
    return f;
  }
  /** [-limit, limit]: the table-scale values a real command log carries. */
  float range(float limit) { return (static_cast<float>(u16()) / 32767.5f - 1.f) * limit; }
  /** [lo, hi]. */
  float between(float lo, float hi) { return lo + static_cast<float>(u16()) / 65535.f * (hi - lo); }
  /** Mostly table-scale; one in eight is a non-finite value (never a huge finite one). */
  float rangeOrNonFinite(float limit) {
    const uint8_t pick = u8();
    if ((pick & 7u) != 0) return range(limit);
    switch ((pick >> 3) & 3u) {
      case 0: return std::numeric_limits<float>::quiet_NaN();
      case 1: return std::numeric_limits<float>::infinity();
      case 2: return -std::numeric_limits<float>::infinity();
      default: return -0.f;
    }
  }

private:
  const uint8_t* data_;
  std::size_t size_;
  std::size_t pos_ = 0;
};

/** Per-family caps the builder will reproduce (Snapshot.h family order). */
inline constexpr uint32_t kFamilyCap[SNAPSHOT_STATIC_FAMILIES] = {
    16, // planes: tested against every body every iteration
    1000, 1000, 1000, 1000, 1000, // boxes, capsules, cylinders, spheres, cones
    64, // pin fields
    1000, 1000, // movers, sensors
    1000, 4096, // meshes, mesh triangles (all in the first mesh)
    1000, // force fields
};

/**
 * Add exactly `counts[f]` statics of each family, laid out on a grid so they
 * are distinct and some are touched. False (world partly built) when a count
 * is past its cap, or there are triangles but no mesh to hold them.
 */
inline bool buildTableWithCounts(PhysicsWorld& w, const uint32_t counts[SNAPSHOT_STATIC_FAMILIES]) {
  for (int f = 0; f < SNAPSHOT_STATIC_FAMILIES; ++f) {
    if (counts[f] > kFamilyCap[f]) return false;
  }
  if (counts[10] > 0 && counts[9] == 0) return false;

  auto at = [](uint32_t i, float spacing) { return (static_cast<float>(i % 32) - 16.f) * spacing; };
  auto row = [](uint32_t i, float spacing) { return static_cast<float>(i >> 5u) * spacing; };

  for (uint32_t i = 0; i < counts[0]; ++i) w.addStaticPlane(0.f, 1.f, 0.f, -static_cast<float>(i) * 0.01f, 0.2f);
  for (uint32_t i = 0; i < counts[1]; ++i)
    w.addStaticBox(at(i, 0.9f), 0.f, row(i, 0.9f), 0.4f, 0.1f, 0.4f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  for (uint32_t i = 0; i < counts[2]; ++i)
    w.addStaticCapsule(at(i, 0.7f), 0.3f, row(i, 0.7f), 0.1f, 0.3f, 0.f, 0.f, 0.70710677f, 0.70710677f, 0.4f, 0.2f);
  for (uint32_t i = 0; i < counts[3]; ++i)
    w.addStaticCylinder(at(i, 0.6f), 0.3f, row(i, 0.6f) + 3.f, 0.08f, 0.3f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.1f);
  for (uint32_t i = 0; i < counts[4]; ++i) w.addStaticSphere(at(i, 0.6f), 0.2f, row(i, 0.6f) - 3.f, 0.15f, 0.5f, 0.2f);
  for (uint32_t i = 0; i < counts[5]; ++i)
    w.addStaticCone(at(i, 0.8f), 0.2f, row(i, 0.8f) + 6.f, 0.3f, 0.2f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  for (uint32_t i = 0; i < counts[6]; ++i) {
    PinFieldDesc pins;
    pins.origin = {at(i, 2.f), 0.3f, row(i, 2.f) + 9.f};
    pins.rows = 3;
    pins.cols = 3;
    pins.spacingX = 0.5f;
    pins.spacingZ = 0.5f;
    pins.rowOffsetX = 0.25f;
    pins.radius = 0.05f;
    pins.halfHeight = 0.3f;
    pins.dropoutSeed = i;
    pins.dropout = 0.1f;
    w.addPinField(pins);
  }
  for (uint32_t i = 0; i < counts[7]; ++i) {
    KinematicMoverDesc mover;
    mover.position = {at(i, 1.f), 0.2f, row(i, 1.f) - 6.f};
    mover.halfExtents = {0.3f, 0.1f, 0.3f};
    mover.shape = static_cast<VolumeShape>(i % 3);
    w.addKinematicMover(mover);
  }
  for (uint32_t i = 0; i < counts[8]; ++i) {
    SensorVolumeDesc sensor;
    sensor.center = {at(i, 1.f), 0.3f, row(i, 1.f) - 9.f};
    sensor.halfExtents = {0.4f, 0.3f, 0.4f};
    sensor.shape = static_cast<VolumeShape>(i % 3);
    w.addSensorVolume(sensor);
  }
  for (uint32_t i = 0; i < counts[9]; ++i) {
    // Every triangle in the first mesh; the rest are empty (legal: all dropped).
    const uint32_t tris = i == 0 ? counts[10] : 0;
    std::vector<float> vertices;
    std::vector<uint32_t> indices;
    vertices.reserve(static_cast<std::size_t>(tris) * 9);
    for (uint32_t t = 0; t < tris; ++t) {
      const float x = at(t, 0.5f), z = row(t, 0.5f) + 12.f;
      for (float v : {x, 0.f, z, x + 0.4f, 0.f, z, x, 0.f, z + 0.4f}) vertices.push_back(v);
      for (uint32_t k = 0; k < 3; ++k) indices.push_back(t * 3 + k);
    }
    w.addStaticTriangleMesh(vertices.data(), static_cast<int>(vertices.size() / 3), indices.data(),
                            static_cast<int>(indices.size()), 0.4f, 0.2f, (i & 1u) != 0);
  }
  for (uint32_t i = 0; i < counts[11]; ++i) {
    ForceFieldDesc field;
    field.center = {at(i, 1.5f), 0.5f, row(i, 1.5f) - 12.f};
    field.halfExtents = {0.7f, 0.7f, 0.7f};
    field.force = {0.f, 2.f, -1.f};
    field.acceleration = true;
    if (i % 2 == 1) {
      field.mode = ForceMode::AxisPull;
      field.strength = 3.f;
    }
    w.addForceField(field);
  }
  return true;
}

inline uint32_t readWordLE(const std::vector<uint8_t>& blob, std::size_t word) {
  const std::size_t at = word * 4;
  return static_cast<uint32_t>(blob[at]) | (static_cast<uint32_t>(blob[at + 1]) << 8) |
         (static_cast<uint32_t>(blob[at + 2]) << 16) | (static_cast<uint32_t>(blob[at + 3]) << 24);
}

inline void writeWordLE(std::vector<uint8_t>& blob, std::size_t word, uint32_t v) {
  const std::size_t at = word * 4;
  for (int b = 0; b < 4; ++b) blob[at + static_cast<std::size_t>(b)] = static_cast<uint8_t>(v >> (8 * b));
}

} // namespace pachinball::fuzz
