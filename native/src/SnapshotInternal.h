/**
 * Internals shared by the snapshot save TU (Snapshot.cpp) and restore TU
 * (SnapshotRestore.cpp). Not part of any public interface: include only from
 * those two files. Format and contract: Snapshot.h.
 */
#pragma once

#include "Snapshot.h"
#include "PhysicsWorld.h"
#include "Boundary.h"

#include <cmath>

#include <cstddef>
#include <cstdint>
#include <iterator>
#include <vector>

namespace pachinball {

/** One static item's content digest and its insertion index (see "Canonical static ordering"). */
struct SnapshotRank {
  uint64_t digest;
  uint32_t index;
};

// ---- Private-state access -------------------------------------------------

/** Friend of BodyStore / HandleTable: the column lists both directions walk. */
struct SnapshotAccess {
  using FloatCol = std::vector<float> BodyStore::*;
  using ByteCol  = std::vector<uint8_t> BodyStore::*;
  using WordCol  = std::vector<uint32_t> BodyStore::*;

  static constexpr FloatCol kFloatCols[] = {
    &BodyStore::posX_, &BodyStore::posY_, &BodyStore::posZ_,
    &BodyStore::velX_, &BodyStore::velY_, &BodyStore::velZ_,
    &BodyStore::angVelX_, &BodyStore::angVelY_, &BodyStore::angVelZ_,
    &BodyStore::rotX_, &BodyStore::rotY_, &BodyStore::rotZ_, &BodyStore::rotW_,
    &BodyStore::forceX_, &BodyStore::forceY_, &BodyStore::forceZ_,
    &BodyStore::invMass_, &BodyStore::invInertia_,
    &BodyStore::radius_, &BodyStore::capsuleHalfHeight_,
    &BodyStore::boxHalfX_, &BodyStore::boxHalfY_, &BodyStore::boxHalfZ_,
    &BodyStore::restitution_, &BodyStore::friction_,
    &BodyStore::linearDamping_, &BodyStore::angularDamping_,
    &BodyStore::mass_,
  };
  static constexpr ByteCol kByteCols[] = {&BodyStore::type_, &BodyStore::shape_, &BodyStore::active_};
  static constexpr WordCol kWordCols[] = {&BodyStore::membership_, &BodyStore::filter_};

  /** Words per body: public id + every column above + the sleep counter. */
  static constexpr std::size_t kBodyWords =
      1 + std::size(kFloatCols) + std::size(kByteCols) + 1 + std::size(kWordCols);

  template <typename Sink>
  static void writeBodies(Sink& w, const BodyStore& s) {
    const std::size_t n = s.denseToPublicId_.size();
    w.u32(static_cast<uint32_t>(n));
    for (int id : s.denseToPublicId_) w.i32(id);
    for (FloatCol c : kFloatCols) for (float v : s.*c) w.f32(v);
    for (ByteCol c : kByteCols) for (uint8_t v : s.*c) w.u32(v);
    for (uint16_t v : s.sleepCounter_) w.u32(v);
    for (WordCol c : kWordCols) for (uint32_t v : s.*c) w.u32(v);
  }

  /** Decode into `out` (a fresh store); false on a malformed column. */
  static bool readBodies(SnapshotReader& r, BodyStore& out) {
    const uint32_t n = r.u32();
    if (!r.fits(n, kBodyWords)) return false;
    out.denseToPublicId_.resize(n);
    for (int& id : out.denseToPublicId_) id = r.i32();
    for (FloatCol c : kFloatCols) {
      (out.*c).resize(n);
      for (float& v : out.*c) v = r.f32();
    }
    for (ByteCol c : kByteCols) {
      (out.*c).resize(n);
      for (uint8_t& v : out.*c) {
        const uint32_t word = r.u32();
        if (word > 0xFFu) return false;
        v = static_cast<uint8_t>(word);
      }
    }
    out.sleepCounter_.resize(n);
    for (uint16_t& v : out.sleepCounter_) {
      const uint32_t word = r.u32();
      if (word > 0xFFFFu) return false;
      v = static_cast<uint16_t>(word);
    }
    for (WordCol c : kWordCols) {
      (out.*c).resize(n);
      for (uint32_t& v : out.*c) v = r.u32();
    }
    for (uint32_t i = 0; i < n; ++i) {
      if (out.type_[i] > static_cast<uint8_t>(BodyType::Kinematic)) return false;
      if (out.shape_[i] > static_cast<uint8_t>(Shape::Box)) return false;
    }
    return !r.failed();
  }

  template <typename Sink>
  static void writeHandles(Sink& w, const HandleTable& h) {
    w.i32(h.nextId_);
    w.u32(static_cast<uint32_t>(h.slots_.size()));
    for (const HandleTable::Slot& s : h.slots_) {
      w.i32(s.denseIndex);
      w.u32(s.generation);
    }
  }

  static bool readHandles(SnapshotReader& r, HandleTable& out) {
    out.nextId_ = r.i32();
    const uint32_t n = r.u32();
    if (!r.fits(n, 2)) return false;
    out.slots_.resize(n);
    for (HandleTable::Slot& s : out.slots_) {
      s.denseIndex = r.i32();
      const uint32_t gen = r.u32();
      if (gen > 0xFFFFu) return false;
      s.generation = static_cast<uint16_t>(gen);
    }
    return !r.failed();
  }

  /**
   * Largest radius / half-extent a restored body may have. Nothing on a table
   * comes close; a crafted 1e30 m ball would make the broadphase walk its
   * whole clamped cell range (BroadphaseGrid::CELL_COORD_LIMIT) every substep.
   */
  static constexpr float kMaxBodyExtent = 10.f;

  /**
   * Every column holds a value the world itself could have written (#520
   * row 8). Floats are finite — a NaN or inf only ever exists between a bad
   * setter and the next substep's quarantine, and NaN payloads differ between
   * builds, so such a blob could not restore bit-exactly anyway. Rotations
   * are unit (integrate and every setter normalise). Inverse mass and inertia
   * are derived values, so they are re-derived and compared: a forged
   * feather-weight ball is refused rather than replayed.
   */
  static bool bodiesValid(const BodyStore& s) {
    for (FloatCol c : kFloatCols) {
      for (float v : s.*c) {
        if (!std::isfinite(v)) return false;
      }
    }
    const std::size_t n = s.denseToPublicId_.size();
    for (std::size_t i = 0; i < n; ++i) {
      if (s.active_[i] > 1) return false;
      if (!isUnitQuat({s.rotX_[i], s.rotY_[i], s.rotZ_[i], s.rotW_[i]})) return false;
      for (float extent : {s.radius_[i], s.capsuleHalfHeight_[i], s.boxHalfX_[i], s.boxHalfY_[i], s.boxHalfZ_[i]}) {
        if (!(extent >= 0.f && extent <= kMaxBodyExtent)) return false;
      }
      RigidBodyDesc d;
      d.type = static_cast<BodyType>(s.type_[i]);
      d.shape = static_cast<Shape>(s.shape_[i]);
      d.mass = s.mass_[i];
      d.radius = s.radius_[i];
      d.capsuleHalfHeight = s.capsuleHalfHeight_[i];
      d.boxHalfExtents = {s.boxHalfX_[i], s.boxHalfY_[i], s.boxHalfZ_[i]};
      // The formulas of BodyStore::appendSlot / setType, the only writers.
      const float invMass = (d.type == BodyType::Dynamic && d.mass > 0.f) ? 1.f / d.mass : 0.f;
      if (s.invMass_[i] != invMass) return false;
      if (s.invInertia_[i] != BodyStore::computeInvInertia(d)) return false;
    }
    return true;
  }

  /** Every live id resolves to its dense slot and back; no stray bindings. */
  static bool consistent(const HandleTable& h, const BodyStore& s) {
    const int n = static_cast<int>(s.denseToPublicId_.size());
    if (h.nextId_ < 0 || static_cast<std::size_t>(h.nextId_) != h.slots_.size()) return false;
    int bound = 0;
    for (const HandleTable::Slot& slot : h.slots_) {
      if (slot.denseIndex < -1 || slot.denseIndex >= n) return false;
      if (slot.denseIndex >= 0) ++bound;
    }
    if (bound != n) return false;
    for (int i = 0; i < n; ++i) {
      const int id = s.denseToPublicId_[static_cast<std::size_t>(i)];
      if (id < 0 || id >= h.nextId_) return false;
      if (h.slots_[static_cast<std::size_t>(id)].denseIndex != i) return false;
    }
    return true;
  }
};

namespace snapshot_detail {


template <typename Sink>
inline void writeVec(Sink& w, const Vec3& v) { w.f32(v.x); w.f32(v.y); w.f32(v.z); }
template <typename Sink>
inline void writeQuat(Sink& w, const Quat& q) { w.f32(q.x); w.f32(q.y); w.f32(q.z); w.f32(q.w); }
inline Vec3 readVec(SnapshotReader& r) { const float x = r.f32(), y = r.f32(), z = r.f32(); return {x, y, z}; }
inline Quat readQuat(SnapshotReader& r) {
  const float x = r.f32(), y = r.f32(), z = r.f32(), qw = r.f32();
  return {x, y, z, qw};
}

inline void hashVec(SnapshotHasher& h, const Vec3& v) { h.f32(v.x); h.f32(v.y); h.f32(v.z); }
inline void hashQuat(SnapshotHasher& h, const Quat& q) { h.f32(q.x); h.f32(q.y); h.f32(q.z); h.f32(q.w); }

inline constexpr std::size_t kHingeWords  = 21;
inline constexpr std::size_t kTargetWords = 8;
inline constexpr std::size_t kContactWords = 12;

/** (membership, filter) for every entry of one static family, in canonical rank order. */
template <typename Sink, typename T, typename Get>
inline void writeGroups(Sink& w, const std::vector<T>& v, const std::vector<SnapshotRank>& rank, Get get) {
  for (const SnapshotRank& k : rank) {
    const auto& d = get(v[k.index]);
    w.u32(d.membership);
    w.u32(d.filter);
  }
}
template <typename T, typename Get>
inline void readGroups(SnapshotReader& r, std::vector<T>& v, const std::vector<SnapshotRank>& rank, Get get) {
  for (const SnapshotRank& k : rank) {
    auto& d = get(v[k.index]);
    d.membership = r.u32();
    d.filter = r.u32();
  }
}

inline constexpr auto self = [](auto& e) -> auto& { return e; };
inline constexpr auto pinDesc = [](auto& f) -> auto& { return f.desc; };

} // namespace snapshot_detail

struct PhysicsWorld::StaticRanking {
  std::vector<SnapshotRank> planes, boxes, capsules, cylinders, spheres, cones, pinFields,
      movers, sensors, meshes, fields;
};

} // namespace pachinball
