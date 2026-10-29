/**
 * World snapshots (#422): `PhysicsWorld::serialize()` / `restore()` and the
 * little-endian word codec they share. Format and contract: Snapshot.h.
 *
 * Restore is two-phase — decode everything into scratch copies, validate,
 * then commit with moves — so a truncated, corrupt or mismatched blob never
 * leaves the world half-restored.
 *
 * The little-endian word codec itself is SnapshotCodec.cpp. All
 * PhysicsWorld methods here are declared in PhysicsWorld.h.
 */
#include "Snapshot.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cstdlib>
#include <iterator>

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

namespace {

template <typename Sink>
void writeVec(Sink& w, const Vec3& v) { w.f32(v.x); w.f32(v.y); w.f32(v.z); }
template <typename Sink>
void writeQuat(Sink& w, const Quat& q) { w.f32(q.x); w.f32(q.y); w.f32(q.z); w.f32(q.w); }
Vec3 readVec(SnapshotReader& r) { const float x = r.f32(), y = r.f32(), z = r.f32(); return {x, y, z}; }
Quat readQuat(SnapshotReader& r) {
  const float x = r.f32(), y = r.f32(), z = r.f32(), qw = r.f32();
  return {x, y, z, qw};
}

void hashVec(SnapshotHasher& h, const Vec3& v) { h.f32(v.x); h.f32(v.y); h.f32(v.z); }
void hashQuat(SnapshotHasher& h, const Quat& q) { h.f32(q.x); h.f32(q.y); h.f32(q.z); h.f32(q.w); }

constexpr std::size_t kHingeWords  = 21;
constexpr std::size_t kTargetWords = 8;
constexpr std::size_t kContactWords = 12;

/** (membership, filter) for every entry of one static family, in canonical rank order. */
template <typename Sink, typename T, typename Get>
void writeGroups(Sink& w, const std::vector<T>& v, const std::vector<SnapshotRank>& rank, Get get) {
  for (const SnapshotRank& k : rank) {
    const auto& d = get(v[k.index]);
    w.u32(d.membership);
    w.u32(d.filter);
  }
}
template <typename T, typename Get>
void readGroups(SnapshotReader& r, std::vector<T>& v, const std::vector<SnapshotRank>& rank, Get get) {
  for (const SnapshotRank& k : rank) {
    auto& d = get(v[k.index]);
    d.membership = r.u32();
    d.filter = r.u32();
  }
}

// ---- Canonical static ordering ---------------------------------------------
//
// A static item's identity for hashing is the digest of its own content, never
// its insertion index. Sorting by (digest, index) gives every family a rank
// order that depends only on what the table holds. The hash folds the sorted
// digests; the per-static runtime state in the blob (group masks, mover poses,
// field vectors) is written and read in that rank order, so a snapshot restores
// onto the right items even when the target world added them in another order,
// and `getStateHash()` (which hashes the same payload) is order-independent
// for statics too. Items with identical content tie-break by insertion index,
// which is harmless unless their unhashed runtime state differs.

template <typename Fill>
uint64_t digestOf(Fill fill) {
  SnapshotHasher h;
  fill(h);
  return h.value();
}

/**
 * Total order on (digest, index), so any sort algorithm gives the same result.
 * qsort rather than std::sort: libc++'s introsort inlines to several KB of WASM
 * per instantiation, and this is not a hot path.
 */
int compareRank(const void* pa, const void* pb) {
  const SnapshotRank& a = *static_cast<const SnapshotRank*>(pa);
  const SnapshotRank& b = *static_cast<const SnapshotRank*>(pb);
  if (a.digest != b.digest) return a.digest < b.digest ? -1 : 1;
  return a.index < b.index ? -1 : (a.index > b.index ? 1 : 0);
}

template <typename T, typename Digest>
std::vector<SnapshotRank> rankFamily(const std::vector<T>& v, Digest digest) {
  std::vector<SnapshotRank> rank;
  rank.reserve(v.size());
  for (std::size_t i = 0; i < v.size(); ++i) rank.push_back({digest(v[i]), static_cast<uint32_t>(i)});
  if (!rank.empty()) std::qsort(rank.data(), rank.size(), sizeof(SnapshotRank), compareRank);
  return rank;
}

void foldFamily(SnapshotHasher& h, const std::vector<SnapshotRank>& rank) {
  h.u32(static_cast<uint32_t>(rank.size()));
  for (const SnapshotRank& k : rank) h.u64(k.digest);
}

uint64_t digestPlane(const PlaneDesc& p) {
  return digestOf([&](SnapshotHasher& h) { hashVec(h, p.normal); h.f32(p.distance); h.f32(p.friction); });
}
uint64_t digestBox(const BoxDesc& b) {
  return digestOf([&](SnapshotHasher& h) {
    hashVec(h, b.center); hashVec(h, b.halfExtents); hashQuat(h, b.rotation);
    h.f32(b.restitution); h.f32(b.friction);
  });
}
/** Capsule, cylinder and cone descriptors share one field layout. */
template <typename Round>
uint64_t digestRound(const Round& c) {
  return digestOf([&](SnapshotHasher& h) {
    hashVec(h, c.center); h.f32(c.radius); h.f32(c.halfHeight); hashQuat(h, c.rotation);
    h.f32(c.restitution); h.f32(c.friction);
  });
}
uint64_t digestSphere(const SphereDesc& s) {
  return digestOf([&](SnapshotHasher& h) {
    hashVec(h, s.center); h.f32(s.radius); h.f32(s.restitution); h.f32(s.friction);
  });
}
uint64_t digestPinField(const PinField& f) {
  return digestOf([&](SnapshotHasher& h) {
    const PinFieldDesc& d = f.desc;
    hashVec(h, d.origin); h.i32(d.rows); h.i32(d.cols);
    h.f32(d.spacingX); h.f32(d.spacingZ); h.f32(d.rowOffsetX);
    h.f32(d.radius); h.f32(d.halfHeight); hashQuat(h, d.rotation);
    h.f32(d.restitution); h.f32(d.friction);
    h.u32(d.dropoutSeed); h.f32(d.dropout);
    h.u32(static_cast<uint32_t>(d.keepOuts.size()));
    for (const PinKeepOut& k : d.keepOuts) { h.f32(k.minX); h.f32(k.maxX); h.f32(k.minZ); h.f32(k.maxZ); }
    // The resolved lattice, not just the inputs: pin-field occupancy is
    // what a replay actually collided with.
    h.i32(f.pinCount);
    h.u32(static_cast<uint32_t>(f.present.size()));
    for (uint8_t p : f.present) h.u32(p);
  });
}
uint64_t digestMover(const KinematicMover& m) {
  return digestOf([&](SnapshotHasher& h) {
    h.u32(static_cast<uint32_t>(m.shape)); hashVec(h, m.halfExtents);
    h.f32(m.restitution); h.f32(m.friction);
  });
}
uint64_t digestSensor(const SensorVolumeDesc& s) {
  return digestOf([&](SnapshotHasher& h) {
    hashVec(h, s.center); h.u32(static_cast<uint32_t>(s.shape));
    hashVec(h, s.halfExtents); hashQuat(h, s.rotation);
  });
}
/** A mesh owns its triangles: their content (not their index range or `meshIndex`) is part of its digest. */
uint64_t digestMesh(const TriangleMeshDesc& m, const std::vector<MeshTriangle>& triangles) {
  return digestOf([&](SnapshotHasher& h) {
    h.f32(m.restitution); h.f32(m.friction); h.u32(m.doubleSided ? 1u : 0u);
    h.i32(m.triangleCount);
    const std::size_t first = static_cast<std::size_t>(std::max(m.firstTriangle, 0));
    const std::size_t last = std::min(triangles.size(), first + static_cast<std::size_t>(std::max(m.triangleCount, 0)));
    for (std::size_t i = first; i < last; ++i) {
      const MeshTriangle& t = triangles[i];
      hashVec(h, t.a); hashVec(h, t.b); hashVec(h, t.c); hashVec(h, t.normal);
    }
  });
}
uint64_t digestField(const ForceFieldDesc& f) {
  return digestOf([&](SnapshotHasher& h) {
    hashVec(h, f.center); hashVec(h, f.halfExtents); hashQuat(h, f.rotation);
    h.u32(static_cast<uint32_t>(f.space)); h.u32(f.acceleration ? 1u : 0u);
    // Only for the newer modes, so a world of plain directional fields hashes
    // exactly as it did before the mode existed.
    if (f.mode != ForceMode::Directional) { h.u32(static_cast<uint32_t>(f.mode)); h.f32(f.strength); }
  });
}

constexpr auto self = [](auto& e) -> auto& { return e; };
constexpr auto pinDesc = [](auto& f) -> auto& { return f.desc; };

} // namespace

// ---- PhysicsWorld ---------------------------------------------------------

void PhysicsWorld::staticCounts(uint32_t out[SNAPSHOT_STATIC_FAMILIES]) const {
  const std::size_t sizes[SNAPSHOT_STATIC_FAMILIES] = {
    planes_.size(), boxes_.size(), capsules_.size(), cylinders_.size(),
    spheres_.size(), cones_.size(), pinFields_.size(), movers_.size(),
    sensors_.size(), meshes_.size(), triangles_.size(), fields_.size(),
  };
  for (int i = 0; i < SNAPSHOT_STATIC_FAMILIES; ++i) out[i] = static_cast<uint32_t>(sizes[i]);
}

struct PhysicsWorld::StaticRanking {
  std::vector<SnapshotRank> planes, boxes, capsules, cylinders, spheres, cones, pinFields,
      movers, sensors, meshes, fields;
};

PhysicsWorld::StaticRanking PhysicsWorld::staticRanking() const {
  StaticRanking r;
  r.planes = rankFamily(planes_, digestPlane);
  r.boxes = rankFamily(boxes_, digestBox);
  r.capsules = rankFamily(capsules_, digestRound<CapsuleDesc>);
  r.cylinders = rankFamily(cylinders_, digestRound<CylinderDesc>);
  r.spheres = rankFamily(spheres_, digestSphere);
  r.cones = rankFamily(cones_, digestRound<ConeDesc>);
  r.pinFields = rankFamily(pinFields_, digestPinField);
  r.movers = rankFamily(movers_, digestMover);
  r.sensors = rankFamily(sensors_, digestSensor);
  r.meshes = rankFamily(meshes_, [this](const TriangleMeshDesc& m) { return digestMesh(m, triangles_); });
  r.fields = rankFamily(fields_, digestField);
  return r;
}

uint64_t PhysicsWorld::staticContentHash() const {
  return staticHashOf(staticRanking());
}

uint64_t PhysicsWorld::staticHashOf(const StaticRanking& r) const {
  SnapshotHasher h;
  uint32_t counts[SNAPSHOT_STATIC_FAMILIES];
  staticCounts(counts);
  for (uint32_t c : counts) h.u32(c);
  h.i32(droppedStatics_);

  // Mesh triangles are folded into their mesh's digest, not hashed on their own.
  for (const std::vector<SnapshotRank>* family :
       {&r.planes, &r.boxes, &r.capsules, &r.cylinders, &r.spheres, &r.cones, &r.pinFields,
        &r.movers, &r.sensors, &r.meshes, &r.fields}) {
    foldFamily(h, *family);
  }
  return h.value();
}

/** Everything after the header — the stepped state `getStateHash()` also hashes. */
template <typename Sink>
void PhysicsWorld::writeState(Sink& w, const StaticRanking& rank) const {
  w.u64(stepCount_);
  w.f32(accumulator_);
  writeVec(w, params_.gravity);
  w.f32(params_.fixedTimestep);
  w.f32(params_.maxSubsteps);
  w.i32(params_.solverIterations);
  w.f32(params_.rollingResistance);
  w.f32(params_.sleepLinearThreshold);
  w.f32(params_.sleepAngularThreshold);
  w.i32(params_.sleepFramesRequired);

  SnapshotAccess::writeHandles(w, handles_);
  SnapshotAccess::writeBodies(w, bodies_);

  w.i32(nextHingeId_);
  w.u32(static_cast<uint32_t>(hinges_.size()));
  for (const HingeJoint& j : hinges_) {
    w.i32(j.id); w.i32(j.bodyId); w.u32(j.active ? 1u : 0u);
    writeVec(w, j.worldAnchor); writeVec(w, j.worldAxis); writeVec(w, j.localAnchor);
    writeQuat(w, j.restRotation);
    w.f32(j.minAngle); w.f32(j.maxAngle);
    w.f32(j.motorTargetVel); w.f32(j.motorMaxTorque); w.f32(j.baumgarte);
  }

  w.u32(static_cast<uint32_t>(bodyTargets_.size()));
  for (const KinematicBodyTarget& t : bodyTargets_) {
    w.i32(t.id); writeVec(w, t.position); writeQuat(w, t.rotation);
  }
  w.u32(static_cast<uint32_t>(drivenBodies_.size()));
  for (int id : drivenBodies_) w.i32(id);

  writeGroups(w, boxes_, rank.boxes, self);
  writeGroups(w, capsules_, rank.capsules, self);
  writeGroups(w, cylinders_, rank.cylinders, self);
  writeGroups(w, spheres_, rank.spheres, self);
  writeGroups(w, cones_, rank.cones, self);
  writeGroups(w, pinFields_, rank.pinFields, pinDesc);
  writeGroups(w, movers_, rank.movers, self);
  writeGroups(w, sensors_, rank.sensors, self);
  writeGroups(w, meshes_, rank.meshes, self);
  writeGroups(w, fields_, rank.fields, self);

  for (const SnapshotRank& k : rank.movers) {
    const KinematicMover& m = movers_[k.index];
    writeVec(w, m.currentPos); writeQuat(w, m.currentRot);
    writeVec(w, m.nextPos); writeQuat(w, m.nextRot);
    w.u32(m.hasNextPose ? 1u : 0u);
    writeVec(w, m.linearVelocity); writeVec(w, m.angularVelocity);
  }
  for (const SnapshotRank& k : rank.fields) {
    const ForceFieldDesc& f = fields_[k.index];
    writeVec(w, f.force);
    w.u32(f.enabled ? 1u : 0u);
  }

  w.u64(contactListener_.generation());
  w.i32(contactListener_.getDroppedContactTotal());
  const std::vector<ContactEvent> manifold = contactListener_.manifold();
  w.u32(static_cast<uint32_t>(manifold.size()));
  for (const ContactEvent& e : manifold) {
    w.i32(e.bodyId1); w.i32(e.bodyId2);
    writeVec(w, e.point); writeVec(w, e.normal);
    w.f32(e.impulse); w.i32(static_cast<int>(e.phase));
    w.u32(e.isSensor ? 1u : 0u); w.i32(e.subIndex);
  }
}

std::vector<uint8_t> PhysicsWorld::serialize() const {
  const StaticRanking rank = staticRanking();
  SnapshotWriter w;
  w.u32(SNAPSHOT_MAGIC);
  w.u32(SNAPSHOT_VERSION);
  w.u32(0); // total word count, patched below
  w.u64(staticHashOf(rank));
  uint32_t counts[SNAPSHOT_STATIC_FAMILIES];
  staticCounts(counts);
  for (uint32_t c : counts) w.u32(c);

  writeState(w, rank);

  w.patch(2, static_cast<uint32_t>(w.wordCount()));
  return w.take();
}

uint64_t PhysicsWorld::getStateHash() const {
  const StaticRanking rank = staticRanking();
  SnapshotHasher h;
  h.u32(SNAPSHOT_VERSION);
  h.u64(staticHashOf(rank));
  writeState(h, rank);
  // Derived from body rotation + rest pose, so already covered above; hashed
  // anyway so a change to computeHingeAngle shows up here, not only in a trace.
  for (const HingeJoint& j : hinges_) {
    if (j.active) { h.i32(j.id); h.f32(getHingeAngle(j.id)); }
  }
  // The insertion order the content hash deliberately ignores: static ids in
  // contacts and the solve order follow it, so two equal-content tables built
  // in another order step differently and must not share a state hash.
  for (const std::vector<SnapshotRank>* family :
       {&rank.planes, &rank.boxes, &rank.capsules, &rank.cylinders, &rank.spheres, &rank.cones,
        &rank.pinFields, &rank.movers, &rank.sensors, &rank.meshes, &rank.fields}) {
    for (const SnapshotRank& k : *family) h.u32(k.index);
  }
  return h.value();
}

SnapshotStatus PhysicsWorld::restore(const uint8_t* data, std::size_t size) {
  if (!data || size < static_cast<std::size_t>(SNAPSHOT_HEADER_WORDS) * 4) return SnapshotStatus::Truncated;
  SnapshotReader r(data, size);
  if (r.u32() != SNAPSHOT_MAGIC) return SnapshotStatus::BadMagic;
  if (r.u32() != SNAPSHOT_VERSION) return SnapshotStatus::BadVersion;
  const uint32_t totalWords = r.u32();
  if (static_cast<std::size_t>(totalWords) * 4 > size) return SnapshotStatus::Truncated;
  if (static_cast<std::size_t>(totalWords) * 4 != size) return SnapshotStatus::Corrupt;

  // Refuse a differently built table before decoding anything else.
  const StaticRanking rank = staticRanking();
  if (r.u64() != staticHashOf(rank)) return SnapshotStatus::StaticMismatch;
  uint32_t counts[SNAPSHOT_STATIC_FAMILIES];
  staticCounts(counts);
  for (uint32_t c : counts) {
    if (r.u32() != c) return SnapshotStatus::StaticMismatch;
  }

  const uint64_t stepCount = r.u64();
  const float accumulator = r.f32();
  WorldParams params;
  params.gravity = readVec(r);
  params.fixedTimestep = r.f32();
  params.maxSubsteps = r.f32();
  params.solverIterations = r.i32();
  params.rollingResistance = r.f32();
  params.sleepLinearThreshold = r.f32();
  params.sleepAngularThreshold = r.f32();
  params.sleepFramesRequired = r.i32();

  HandleTable handles;
  BodyStore bodies;
  if (!SnapshotAccess::readHandles(r, handles)) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
  if (!SnapshotAccess::readBodies(r, bodies)) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
  if (!SnapshotAccess::consistent(handles, bodies)) return SnapshotStatus::Corrupt;

  const int nextHingeId = r.i32();
  const uint32_t hingeCount = r.u32();
  if (!r.fits(hingeCount, kHingeWords)) return SnapshotStatus::Truncated;
  std::vector<HingeJoint> hinges(hingeCount);
  for (HingeJoint& j : hinges) {
    j.id = r.i32(); j.bodyId = r.i32(); j.active = r.u32() != 0;
    j.worldAnchor = readVec(r); j.worldAxis = readVec(r); j.localAnchor = readVec(r);
    j.restRotation = readQuat(r);
    j.minAngle = r.f32(); j.maxAngle = r.f32();
    j.motorTargetVel = r.f32(); j.motorMaxTorque = r.f32(); j.baumgarte = r.f32();
  }

  const uint32_t targetCount = r.u32();
  if (!r.fits(targetCount, kTargetWords)) return SnapshotStatus::Truncated;
  std::vector<KinematicBodyTarget> targets(targetCount);
  for (KinematicBodyTarget& t : targets) {
    t.id = r.i32(); t.position = readVec(r); t.rotation = readQuat(r);
  }
  const uint32_t drivenCount = r.u32();
  if (!r.fits(drivenCount, 1)) return SnapshotStatus::Truncated;
  std::vector<int> driven(drivenCount);
  for (int& id : driven) id = r.i32();

  // Runtime state of the (hash-verified) statics, decoded into copies.
  std::vector<BoxDesc> boxes = boxes_;
  std::vector<CapsuleDesc> capsules = capsules_;
  std::vector<CylinderDesc> cylinders = cylinders_;
  std::vector<SphereDesc> spheres = spheres_;
  std::vector<ConeDesc> cones = cones_;
  std::vector<PinField> pinFields = pinFields_;
  std::vector<KinematicMover> movers = movers_;
  std::vector<SensorVolumeDesc> sensors = sensors_;
  std::vector<TriangleMeshDesc> meshes = meshes_;
  std::vector<ForceFieldDesc> fields = fields_;
  readGroups(r, boxes, rank.boxes, self);
  readGroups(r, capsules, rank.capsules, self);
  readGroups(r, cylinders, rank.cylinders, self);
  readGroups(r, spheres, rank.spheres, self);
  readGroups(r, cones, rank.cones, self);
  readGroups(r, pinFields, rank.pinFields, pinDesc);
  readGroups(r, movers, rank.movers, self);
  readGroups(r, sensors, rank.sensors, self);
  readGroups(r, meshes, rank.meshes, self);
  readGroups(r, fields, rank.fields, self);
  for (const SnapshotRank& k : rank.movers) {
    KinematicMover& m = movers[k.index];
    m.currentPos = readVec(r); m.currentRot = readQuat(r);
    m.nextPos = readVec(r); m.nextRot = readQuat(r);
    m.hasNextPose = r.u32() != 0;
    m.linearVelocity = readVec(r); m.angularVelocity = readVec(r);
  }
  for (const SnapshotRank& k : rank.fields) {
    ForceFieldDesc& f = fields[k.index];
    f.force = readVec(r);
    f.enabled = r.u32() != 0;
  }

  const uint64_t generation = r.u64();
  const int droppedTotal = r.i32();
  const uint32_t contactCount = r.u32();
  if (!r.fits(contactCount, kContactWords)) return SnapshotStatus::Truncated;
  std::vector<ContactEvent> manifold(contactCount);
  for (ContactEvent& e : manifold) {
    e.bodyId1 = r.i32(); e.bodyId2 = r.i32();
    e.point = readVec(r); e.normal = readVec(r);
    e.impulse = r.f32();
    const int phase = r.i32();
    if (phase < 0 || phase > static_cast<int>(ContactPhase::Exit)) return SnapshotStatus::Corrupt;
    e.phase = static_cast<ContactPhase>(phase);
    e.isSensor = r.u32() != 0;
    e.subIndex = r.i32();
  }

  if (r.failed()) return SnapshotStatus::Truncated;
  if (r.remainingWords() != 0) return SnapshotStatus::Corrupt;

  // ---- Commit: nothing below can fail. ----
  stepCount_ = stepCount;
  accumulator_ = accumulator;
  params_ = params;
  handles_ = std::move(handles);
  bodies_ = std::move(bodies);
  nextHingeId_ = nextHingeId;
  hinges_ = std::move(hinges);
  bodyTargets_ = std::move(targets);
  drivenBodies_ = std::move(driven);
  boxes_ = std::move(boxes);
  capsules_ = std::move(capsules);
  cylinders_ = std::move(cylinders);
  spheres_ = std::move(spheres);
  cones_ = std::move(cones);
  pinFields_ = std::move(pinFields);
  movers_ = std::move(movers);
  sensors_ = std::move(sensors);
  meshes_ = std::move(meshes);
  fields_ = std::move(fields);
  pairs_.clear();
  quarantines_.clear();
  contactListener_.restoreManifold(manifold, generation, droppedTotal);
  scatterTransforms();
  return SnapshotStatus::Ok;
}

} // namespace pachinball
