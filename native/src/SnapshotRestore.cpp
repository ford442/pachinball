/**
 * World snapshots (#422), restore side: `PhysicsWorld::restore()`.
 *
 * Restore is two-phase — decode everything into scratch copies, validate,
 * then commit with moves — so a truncated, corrupt or mismatched blob never
 * leaves the world half-restored. Save side: Snapshot.cpp.
 */
#include "SnapshotInternal.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

namespace pachinball {

using namespace snapshot_detail;

namespace {

// ---- Restore validation (#520 row 8) ----------------------------------------
//
// restore() decodes into scratch copies; each check below runs before the
// commit, so a refused blob leaves the world exactly as it was. Each accepts
// what the world's own setters can store — they sanitise their inputs
// (Boundary.h) — so a world's own snapshot always restores.

int compareInt(const void* pa, const void* pb) {
  const int a = *static_cast<const int*>(pa);
  const int b = *static_cast<const int*>(pb);
  return a < b ? -1 : (a > b ? 1 : 0);
}

/** True when no id repeats. O(n log n): a blob can carry millions of entries. */
bool idsUnique(std::vector<int> ids) {
  if (ids.size() < 2) return true;
  std::qsort(ids.data(), ids.size(), sizeof(int), compareInt);
  return std::adjacent_find(ids.begin(), ids.end()) == ids.end();
}

/**
 * Hinge records as createHinge / setHingeMotor write them: ids ascending and
 * below `nextHingeId`, a live body, finite anchors, a unit axis and rest
 * rotation, limits within ±π, a non-negative motor torque and a positive
 * Baumgarte factor.
 */
bool hingeValid(const HingeJoint& j, const HandleTable& handles) {
  return handles.findDenseIndex(j.bodyId) >= 0 && isFiniteVec3(j.worldAnchor) && isFiniteVec3(j.localAnchor) &&
         isUnitVec3(j.worldAxis) && isUnitQuat(j.restRotation) && std::fabs(j.minAngle) <= HINGE_ANGLE_LIMIT &&
         std::fabs(j.maxAngle) <= HINGE_ANGLE_LIMIT && std::isfinite(j.motorTargetVel) &&
         std::isfinite(j.motorMaxTorque) && j.motorMaxTorque >= 0.f && std::isfinite(j.baumgarte) && j.baumgarte > 0.f;
}

bool moverValid(const KinematicMover& m) {
  return isFiniteVec3(m.currentPos) && isUnitQuat(m.currentRot) && isFiniteVec3(m.nextPos) && isUnitQuat(m.nextRot) &&
         isFiniteVec3(m.linearVelocity) && isFiniteVec3(m.angularVelocity);
}

/**
 * Manifold entries as flushEvents leaves them: strictly ascending pair keys,
 * pin indices ≥ 0. Their floats are not checked: they only ever feed an Exit
 * event, never the solver, and a live world can store an overflowed impulse.
 */
bool manifoldValid(const std::vector<ContactEvent>& manifold) {
  for (std::size_t i = 0; i < manifold.size(); ++i) {
    const ContactEvent& e = manifold[i];
    if (e.subIndex < 0) return false;
    if (i > 0) {
      const ContactEvent& p = manifold[i - 1];
      if (contactPairKey(p.bodyId1, p.bodyId2) >= contactPairKey(e.bodyId1, e.bodyId2)) return false;
    }
  }
  return true;
}

} // namespace

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
  if (r.failed()) return SnapshotStatus::Truncated;
  if (!worldParamsValid(params)) return SnapshotStatus::Corrupt;
  // step() keeps the accumulator in [0, maxAccumulator]: a NaN froze the
  // world (no comparison passes), +inf ran every substep of every tick.
  if (!(accumulator >= 0.f && accumulator <= maxAccumulator(params))) return SnapshotStatus::Corrupt;

  HandleTable handles;
  BodyStore bodies;
  if (!SnapshotAccess::readHandles(r, handles)) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
  if (!SnapshotAccess::readBodies(r, bodies)) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
  if (!SnapshotAccess::consistent(handles, bodies)) return SnapshotStatus::Corrupt;
  if (!SnapshotAccess::bodiesValid(bodies)) return SnapshotStatus::Corrupt;

  const int nextHingeId = r.i32();
  const uint32_t hingeCount = r.u32();
  if (!r.fits(hingeCount, kHingeWords)) return SnapshotStatus::Truncated;
  if (nextHingeId < 0) return SnapshotStatus::Corrupt;
  std::vector<HingeJoint> hinges;
  hinges.reserve(hingeCount);
  int lastHingeId = -1;
  for (uint32_t i = 0; i < hingeCount; ++i) {
    HingeJoint j;
    j.id = r.i32(); j.bodyId = r.i32(); j.active = r.u32() != 0;
    j.worldAnchor = readVec(r); j.worldAxis = readVec(r); j.localAnchor = readVec(r);
    j.restRotation = readQuat(r);
    j.minAngle = r.f32(); j.maxAngle = r.f32();
    j.motorTargetVel = r.f32(); j.motorMaxTorque = r.f32(); j.baumgarte = r.f32();
    if (r.failed()) return SnapshotStatus::Truncated;
    if (j.id <= lastHingeId || j.id >= nextHingeId) return SnapshotStatus::Corrupt;
    lastHingeId = j.id;
    // Blobs written before #520 row 12 still list removed hinges, disabled.
    // A live world holds none, so they are dropped rather than restored.
    if (!j.active) continue;
    if (!hingeValid(j, handles)) return SnapshotStatus::Corrupt;
    hinges.push_back(j);
  }

  const uint32_t targetCount = r.u32();
  if (!r.fits(targetCount, kTargetWords)) return SnapshotStatus::Truncated;
  std::vector<KinematicBodyTarget> targets(targetCount);
  std::vector<int> targetIds;
  targetIds.reserve(targetCount);
  for (KinematicBodyTarget& t : targets) {
    t.id = r.i32(); t.position = readVec(r); t.rotation = readQuat(r);
    // As setNextKinematicTransform stores them: body ids, finite, unit, one per body.
    if (t.id < 0 || !isFiniteVec3(t.position) || !isUnitQuat(t.rotation)) {
      return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
    }
    targetIds.push_back(t.id);
  }
  if (!idsUnique(std::move(targetIds))) return SnapshotStatus::Corrupt;
  const uint32_t drivenCount = r.u32();
  if (!r.fits(drivenCount, 1)) return SnapshotStatus::Truncated;
  std::vector<int> driven(drivenCount);
  for (int& id : driven) {
    id = r.i32();
    if (id < 0) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
  }
  if (!idsUnique(driven)) return SnapshotStatus::Corrupt;

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
    if (!moverValid(m)) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
  }
  for (const SnapshotRank& k : rank.fields) {
    ForceFieldDesc& f = fields[k.index];
    f.force = readVec(r);
    f.enabled = r.u32() != 0;
    if (!isFiniteVec3(f.force)) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
  }

  const uint64_t generation = r.u64();
  const int droppedTotal = r.i32();
  if (droppedTotal < 0) return r.failed() ? SnapshotStatus::Truncated : SnapshotStatus::Corrupt;
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
  if (!manifoldValid(manifold)) return SnapshotStatus::Corrupt;

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
