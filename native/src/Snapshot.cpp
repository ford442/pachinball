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

#include <iterator>

namespace pachinball {

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

  static void writeBodies(SnapshotWriter& w, const BodyStore& s) {
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

  static void writeHandles(SnapshotWriter& w, const HandleTable& h) {
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

void writeVec(SnapshotWriter& w, const Vec3& v) { w.f32(v.x); w.f32(v.y); w.f32(v.z); }
void writeQuat(SnapshotWriter& w, const Quat& q) { w.f32(q.x); w.f32(q.y); w.f32(q.z); w.f32(q.w); }
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

/** (membership, filter) for every entry of one static family. */
template <typename T, typename Get>
void writeGroups(SnapshotWriter& w, const std::vector<T>& v, Get get) {
  for (const T& e : v) {
    const auto& d = get(e);
    w.u32(d.membership);
    w.u32(d.filter);
  }
}
template <typename T, typename Get>
void readGroups(SnapshotReader& r, std::vector<T>& v, Get get) {
  for (T& e : v) {
    auto& d = get(e);
    d.membership = r.u32();
    d.filter = r.u32();
  }
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

uint64_t PhysicsWorld::staticContentHash() const {
  SnapshotHasher h;
  uint32_t counts[SNAPSHOT_STATIC_FAMILIES];
  staticCounts(counts);
  for (uint32_t c : counts) h.u32(c);
  h.i32(droppedStatics_);

  for (const PlaneDesc& p : planes_) { hashVec(h, p.normal); h.f32(p.distance); h.f32(p.friction); }
  for (const BoxDesc& b : boxes_) {
    hashVec(h, b.center); hashVec(h, b.halfExtents); hashQuat(h, b.rotation);
    h.f32(b.restitution); h.f32(b.friction);
  }
  for (const CapsuleDesc& c : capsules_) {
    hashVec(h, c.center); h.f32(c.radius); h.f32(c.halfHeight); hashQuat(h, c.rotation);
    h.f32(c.restitution); h.f32(c.friction);
  }
  for (const CylinderDesc& c : cylinders_) {
    hashVec(h, c.center); h.f32(c.radius); h.f32(c.halfHeight); hashQuat(h, c.rotation);
    h.f32(c.restitution); h.f32(c.friction);
  }
  for (const SphereDesc& s : spheres_) {
    hashVec(h, s.center); h.f32(s.radius); h.f32(s.restitution); h.f32(s.friction);
  }
  for (const ConeDesc& c : cones_) {
    hashVec(h, c.center); h.f32(c.radius); h.f32(c.halfHeight); hashQuat(h, c.rotation);
    h.f32(c.restitution); h.f32(c.friction);
  }
  for (const PinField& f : pinFields_) {
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
  }
  for (const KinematicMover& m : movers_) {
    h.u32(static_cast<uint32_t>(m.shape)); hashVec(h, m.halfExtents);
    h.f32(m.restitution); h.f32(m.friction);
  }
  for (const SensorVolumeDesc& s : sensors_) {
    hashVec(h, s.center); h.u32(static_cast<uint32_t>(s.shape));
    hashVec(h, s.halfExtents); hashQuat(h, s.rotation);
  }
  for (const TriangleMeshDesc& m : meshes_) {
    h.f32(m.restitution); h.f32(m.friction); h.u32(m.doubleSided ? 1u : 0u);
    h.i32(m.firstTriangle); h.i32(m.triangleCount);
  }
  for (const MeshTriangle& t : triangles_) {
    hashVec(h, t.a); hashVec(h, t.b); hashVec(h, t.c); hashVec(h, t.normal); h.i32(t.meshIndex);
  }
  for (const ForceFieldDesc& f : fields_) {
    hashVec(h, f.center); hashVec(h, f.halfExtents); hashQuat(h, f.rotation);
    h.u32(static_cast<uint32_t>(f.space)); h.u32(f.acceleration ? 1u : 0u);
  }
  return h.value();
}

std::vector<uint8_t> PhysicsWorld::serialize() const {
  SnapshotWriter w;
  w.u32(SNAPSHOT_MAGIC);
  w.u32(SNAPSHOT_VERSION);
  w.u32(0); // total word count, patched below
  w.u64(staticContentHash());
  uint32_t counts[SNAPSHOT_STATIC_FAMILIES];
  staticCounts(counts);
  for (uint32_t c : counts) w.u32(c);

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

  writeGroups(w, boxes_, self);
  writeGroups(w, capsules_, self);
  writeGroups(w, cylinders_, self);
  writeGroups(w, spheres_, self);
  writeGroups(w, cones_, self);
  writeGroups(w, pinFields_, pinDesc);
  writeGroups(w, movers_, self);
  writeGroups(w, sensors_, self);
  writeGroups(w, meshes_, self);
  writeGroups(w, fields_, self);

  for (const KinematicMover& m : movers_) {
    writeVec(w, m.currentPos); writeQuat(w, m.currentRot);
    writeVec(w, m.nextPos); writeQuat(w, m.nextRot);
    w.u32(m.hasNextPose ? 1u : 0u);
    writeVec(w, m.linearVelocity); writeVec(w, m.angularVelocity);
  }
  for (const ForceFieldDesc& f : fields_) {
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

  w.patch(2, static_cast<uint32_t>(w.wordCount()));
  return w.take();
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
  if (r.u64() != staticContentHash()) return SnapshotStatus::StaticMismatch;
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
  readGroups(r, boxes, self);
  readGroups(r, capsules, self);
  readGroups(r, cylinders, self);
  readGroups(r, spheres, self);
  readGroups(r, cones, self);
  readGroups(r, pinFields, pinDesc);
  readGroups(r, movers, self);
  readGroups(r, sensors, self);
  readGroups(r, meshes, self);
  readGroups(r, fields, self);
  for (KinematicMover& m : movers) {
    m.currentPos = readVec(r); m.currentRot = readQuat(r);
    m.nextPos = readVec(r); m.nextRot = readQuat(r);
    m.hasNextPose = r.u32() != 0;
    m.linearVelocity = readVec(r); m.angularVelocity = readVec(r);
  }
  for (ForceFieldDesc& f : fields) {
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
  contactListener_.restoreManifold(manifold, generation, droppedTotal);
  scatterTransforms();
  return SnapshotStatus::Ok;
}

} // namespace pachinball
