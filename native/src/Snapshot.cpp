/**
 * World snapshots (#422), save side: `PhysicsWorld::serialize()`,
 * `getStateHash()` and the canonical static ranking both directions share.
 * Restore is SnapshotRestore.cpp; shared internals are SnapshotInternal.h;
 * the little-endian word codec is SnapshotCodec.cpp. Format and contract:
 * Snapshot.h. All PhysicsWorld methods here are declared in PhysicsWorld.h.
 */
#include "SnapshotInternal.h"

#include <cstdlib>

namespace pachinball {

using namespace snapshot_detail;

namespace {

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

} // namespace pachinball
