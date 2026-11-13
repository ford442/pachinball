#include "PhysicsWorld.h"
#include "Boundary.h"
#include "HingeJoint.h"
#include "KinematicMover.h"
#include <cmath>
#include <algorithm>
#include <cstdlib>

namespace pachinball {

PhysicsWorld::PhysicsWorld(const WorldParams& params)
    : params_(params) {
  // The boundary WorldParams enters through; stored sanitised, so the state
  // hash of a NaN cap equals the default's.
  params_.maxSubsteps = sanitizedMaxSubsteps(params_.maxSubsteps);
}

PhysicsWorld::~PhysicsWorld() {
  freeTransformBuffer();
}

int PhysicsWorld::createRigidBody(const RigidBodyDesc& desc) {
  // A tag outside its enum becomes the default it already behaved as (Boundary.h):
  // stored raw, it made the world refuse its own snapshot.
  RigidBodyDesc d = desc;
  d.type = sanitized(desc.type);
  d.shape = sanitized(desc.shape);
  return bodies_.create(handles_, d);
}

void PhysicsWorld::removeRigidBody(int id) {
  // A hinge cannot outlive its body (#520 row 12): erased, not just disabled,
  // so it leaves the solve loop, the snapshot and the state hash.
  eraseHingesIf([id](const HingeJoint& h) { return h.bodyId == id; });
  bodies_.remove(handles_, id);
}

// ---- Hinges ---------------------------------------------------------------
//
// `hinges_` holds live hinges only, in id order: ids come from the monotonic
// `nextHingeId_` (never reissued — the worker client's WasmIdShadow mirrors
// it), every create appends, and erasing keeps the order. So a lookup is a
// binary search and the solve order is creation order, as it always was.

HingeJoint* PhysicsWorld::findHinge(int id) {
  const auto it =
      std::lower_bound(hinges_.begin(), hinges_.end(), id, [](const HingeJoint& h, int key) { return h.id < key; });
  return (it != hinges_.end() && it->id == id) ? &*it : nullptr;
}

const HingeJoint* PhysicsWorld::findHinge(int id) const {
  return const_cast<PhysicsWorld*>(this)->findHinge(id);
}

int PhysicsWorld::createHinge(int bodyId, const HingeDesc& desc) {
  BodyView body = findViewMut(bodyId);
  if (!body.valid()) return -1;

  HingeJoint h;
  h.id = nextHingeId_++;
  h.bodyId = bodyId;
  h.active = true;
  // Non-finite inputs fall back rather than fail: a refused create would skip
  // an id the worker client already handed out (Boundary.h).
  h.worldAnchor = isFiniteVec3(desc.worldAnchor) ? desc.worldAnchor : body.getPosition();
  const float axisLen = desc.worldAxis.length();
  h.worldAxis = (std::isfinite(axisLen) && axisLen > 1e-8f) ? desc.worldAxis / axisLen : Vec3::up();
  h.restRotation = body.getRotation();
  h.localAnchor = h.restRotation.conjugate().rotate(h.worldAnchor - body.getPosition());
  // The hinge angle is wrapped to [-π, π], so a limit past ±π is the same
  // "no limit" at ±π — except a min above π (or max below -π), which is
  // violated at every angle by up to its own size: 1e24 rad of error spun
  // the body until its rotation overflowed (fuzz_command_stream).
  auto limit = [](float angle, float fallback) {
    return std::isnan(angle) ? fallback : std::clamp(angle, -HINGE_ANGLE_LIMIT, HINGE_ANGLE_LIMIT);
  };
  h.minAngle = limit(desc.minAngle, HingeDesc{}.minAngle);
  h.maxAngle = limit(desc.maxAngle, HingeDesc{}.maxAngle);
  h.motorTargetVel = std::isfinite(desc.motorTargetVel) ? desc.motorTargetVel : 0.f;
  h.motorMaxTorque = (std::isfinite(desc.motorMaxTorque) && desc.motorMaxTorque > 0.f) ? desc.motorMaxTorque : 0.f;
  h.baumgarte = (std::isfinite(desc.baumgarte) && desc.baumgarte > 0.f) ? desc.baumgarte : 0.2f;
  hinges_.push_back(h);
  return h.id;
}

void PhysicsWorld::setHingeMotor(int id, float targetVel, float maxTorque) {
  HingeJoint* h = findHinge(id);
  if (!h) return;
  h->motorTargetVel = std::isfinite(targetVel) ? targetVel : 0.f;
  h->motorMaxTorque = (std::isfinite(maxTorque) && maxTorque > 0.f) ? maxTorque : 0.f;
  BodyView body = findViewMut(h->bodyId);
  if (body.valid()) body.wake();
}

float PhysicsWorld::getHingeAngle(int id) const {
  const HingeJoint* h = findHinge(id);
  if (!h) return 0.f;
  BodyView body = findView(h->bodyId);
  if (!body.valid()) return 0.f;
  return computeHingeAngle(*h, body.getRotation());
}

void PhysicsWorld::removeHinge(int id) {
  eraseHingesIf([id](const HingeJoint& h) { return h.id == id; });
}

void PhysicsWorld::solveHinges(float dt) {
  for (HingeJoint& h : hinges_) {
    BodyView body = findViewMut(h.bodyId);
    // removeRigidBody erases a body's hinges, so every hinge here has one.
    if (body.valid()) solveWorldHinge(h, body, dt);
  }
}

BodyView PhysicsWorld::findViewMut(int id) {
  return bodies_.viewById(handles_, id);
}

BodyView PhysicsWorld::findView(int id) const {
  const int dense = handles_.findDenseIndex(id);
  if (dense < 0) return {};
  return const_cast<BodyStore&>(bodies_).view(dense);
}

void PhysicsWorld::applyForce(int id, float fx, float fy, float fz) {
  BodyView b = findViewMut(id);
  if (b.valid()) b.applyForce({fx, fy, fz});
}

void PhysicsWorld::applyImpulse(int id, float ix, float iy, float iz) {
  BodyView b = findViewMut(id);
  if (b.valid()) b.applyImpulse({ix, iy, iz});
}

void PhysicsWorld::setVelocity(int id, float vx, float vy, float vz) {
  BodyView b = findViewMut(id);
  if (b.valid()) b.setVelocity({vx, vy, vz});
}

void PhysicsWorld::setAngularVelocity(int id, float wx, float wy, float wz) {
  BodyView b = findViewMut(id);
  if (b.valid()) b.setAngularVelocity({wx, wy, wz});
}

void PhysicsWorld::setBodyPosition(int id, float px, float py, float pz) {
  BodyView b = findViewMut(id);
  if (b.valid()) b.setPosition({px, py, pz});
}

void PhysicsWorld::setBodyRotation(int id, float qx, float qy, float qz, float qw) {
  BodyView b = findViewMut(id);
  if (b.valid()) b.setRotation(sanitizedRotation({qx, qy, qz, qw}));
}

void PhysicsWorld::addStaticPlane(float nx, float ny, float nz, float distance, float friction) {
  // The solver reads `normal` as unit: (0, 2, 0) sank a ball to half its
  // radius. A plane has no handle, so one with no direction is simply refused.
  Vec3 normal;
  if (!sanitizedDirection({nx, ny, nz}, normal) || !std::isfinite(distance)) {
    ++droppedStatics_;
    return;
  }
  planes_.push_back({normal, distance, friction});
}

int PhysicsWorld::addStaticBox(float px, float py, float pz,
                               float hx, float hy, float hz,
                               float qx, float qy, float qz, float qw,
                               float restitution, float friction) {
  if (boxes_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  BoxDesc box;
  box.center = {px, py, pz};
  box.halfExtents = {hx, hy, hz};
  box.rotation = sanitizedRotation({qx, qy, qz, qw});
  box.restitution = restitution;
  box.friction = friction;
  boxes_.push_back(box);
  const int idx = static_cast<int>(boxes_.size()) - 1;
  broadphase_.insertStaticBox(idx, box);
  return STATIC_BOX_ID_BASE - idx;
}

int PhysicsWorld::addStaticCapsule(float px, float py, float pz,
                                   float radius, float halfHeight,
                                   float qx, float qy, float qz, float qw,
                                   float restitution, float friction) {
  if (capsules_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  CapsuleDesc cap;
  cap.center = {px, py, pz};
  cap.radius = radius;
  cap.halfHeight = halfHeight;
  cap.rotation = sanitizedRotation({qx, qy, qz, qw});
  cap.restitution = restitution;
  cap.friction = friction;
  capsules_.push_back(cap);
  const int idx = static_cast<int>(capsules_.size()) - 1;
  broadphase_.insertStaticCapsule(idx, cap);
  return STATIC_CAPSULE_ID_BASE - idx;
}

int PhysicsWorld::addKinematicMover(const KinematicMoverDesc& desc) {
  if (movers_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  KinematicMover mover;
  mover.shape = sanitized(desc.shape);
  mover.halfExtents = desc.halfExtents;
  // Its pose is runtime state (snapshotted), so it must stay finite.
  const Vec3 position = isFiniteVec3(desc.position) ? desc.position : Vec3::zero();
  const Quat rotation = sanitizedRotation(desc.rotation);
  mover.currentPos = position;
  mover.currentRot = rotation;
  mover.nextPos = position;
  mover.nextRot = rotation;
  mover.restitution = desc.restitution;
  mover.friction = desc.friction;
  mover.membership = desc.membership;
  mover.filter = desc.filter;
  movers_.push_back(mover);
  const int idx = static_cast<int>(movers_.size()) - 1;
  return KINEMATIC_MOVER_ID_BASE - idx;
}

void PhysicsWorld::setNextKinematicTransform(int id, float px, float py, float pz,
                                             float qx, float qy, float qz, float qw) {
  // A kinematic pose is never quarantined (only dynamic bodies are), so a
  // non-finite target would stay in the world for good: dropped instead.
  const Vec3 position{px, py, pz};
  if (!isFiniteVec3(position)) return;
  const Quat rotation = sanitizedRotation({qx, qy, qz, qw});
  if (id >= 0) {
    pushKinematicBodyTarget(id, position, rotation);
    return;
  }
  // Mover ids run (KINEMATIC_MOVER_ID_BASE - capacity, KINEMATIC_MOVER_ID_BASE];
  // anything else (another family's id) names no mover.
  if (id > KINEMATIC_MOVER_ID_BASE) return;
  const std::size_t idx = static_cast<std::size_t>(KINEMATIC_MOVER_ID_BASE - id);
  if (idx >= movers_.size()) return;
  movers_[idx].nextPos = position;
  movers_[idx].nextRot = rotation;
  movers_[idx].hasNextPose = true;
}

int PhysicsWorld::addSensorVolume(const SensorVolumeDesc& desc) {
  if (sensors_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  SensorVolumeDesc d = desc;
  d.shape = sanitized(desc.shape);
  d.rotation = sanitizedRotation(desc.rotation);
  sensors_.push_back(d);
  const int idx = static_cast<int>(sensors_.size()) - 1;
  broadphase_.insertSensorVolume(idx, d);
  return SENSOR_VOLUME_ID_BASE - idx;
}

void PhysicsWorld::clearStaticGeometry() {
  droppedStatics_ = 0;
  planes_.clear();
  boxes_.clear();
  capsules_.clear();
  cylinders_.clear();
  spheres_.clear();
  cones_.clear();
  pinFields_.clear();
  movers_.clear();
  sensors_.clear();
  meshes_.clear();
  triangles_.clear();
  fields_.clear();
  broadphase_.clearStatics();
  // Mover cells are rebuilt from scratch every substep, so clearing the
  // vector above is all that is needed there.
  contactListener_.resetManifold();
}

void PhysicsWorld::setCollisionGroups(int id, uint32_t membership, uint32_t filter) {
  if (id >= 0) {
    BodyView b = findViewMut(id);
    if (b.valid()) b.setCollisionGroups(membership, filter);
    return;
  }
  if (id <= STATIC_BOX_ID_BASE && id > STATIC_CAPSULE_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(STATIC_BOX_ID_BASE - id);
    if (idx < boxes_.size()) { boxes_[idx].membership = membership; boxes_[idx].filter = filter; }
  } else if (id <= STATIC_CAPSULE_ID_BASE && id > KINEMATIC_MOVER_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(STATIC_CAPSULE_ID_BASE - id);
    if (idx < capsules_.size()) { capsules_[idx].membership = membership; capsules_[idx].filter = filter; }
  } else if (id <= KINEMATIC_MOVER_ID_BASE && id > SENSOR_VOLUME_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(KINEMATIC_MOVER_ID_BASE - id);
    if (idx < movers_.size()) { movers_[idx].membership = membership; movers_[idx].filter = filter; }
  } else if (id <= SENSOR_VOLUME_ID_BASE && id > STATIC_CYLINDER_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(SENSOR_VOLUME_ID_BASE - id);
    if (idx < sensors_.size()) { sensors_[idx].membership = membership; sensors_[idx].filter = filter; }
  } else if (id <= STATIC_CYLINDER_ID_BASE && id > STATIC_MESH_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(STATIC_CYLINDER_ID_BASE - id);
    if (idx < cylinders_.size()) { cylinders_[idx].membership = membership; cylinders_[idx].filter = filter; }
  } else if (id <= STATIC_MESH_ID_BASE && id > FORCE_FIELD_ID_BASE) {
    // Held on the mesh, not duplicated per triangle, so this stays O(1) and
    // the broadphase still reads the mask live.
    const std::size_t idx = static_cast<std::size_t>(STATIC_MESH_ID_BASE - id);
    if (idx < meshes_.size()) { meshes_[idx].membership = membership; meshes_[idx].filter = filter; }
  } else if (id <= FORCE_FIELD_ID_BASE && id > STATIC_SPHERE_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(FORCE_FIELD_ID_BASE - id);
    if (idx < fields_.size()) { fields_[idx].membership = membership; fields_[idx].filter = filter; }
  } else if (id <= STATIC_SPHERE_ID_BASE && id > STATIC_CONE_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(STATIC_SPHERE_ID_BASE - id);
    if (idx < spheres_.size()) { spheres_[idx].membership = membership; spheres_[idx].filter = filter; }
  } else if (id <= STATIC_CONE_ID_BASE && id > PIN_FIELD_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(STATIC_CONE_ID_BASE - id);
    if (idx < cones_.size()) { cones_[idx].membership = membership; cones_[idx].filter = filter; }
  } else if (id <= PIN_FIELD_ID_BASE) {
    // One mask for the whole lattice: disabling the table's pins is O(1).
    const std::size_t idx = static_cast<std::size_t>(PIN_FIELD_ID_BASE - id);
    if (idx < pinFields_.size()) { pinFields_[idx].desc.membership = membership; pinFields_[idx].desc.filter = filter; }
  }
}

void PhysicsWorld::setGravity(float gx, float gy, float gz) {
  // A non-finite world parameter is never applied: worldParamsValid() would
  // then refuse the world's own snapshot.
  const Vec3 g{gx, gy, gz};
  if (isFiniteVec3(g)) params_.gravity = g;
}

void PhysicsWorld::setRollingResistance(float rr) {
  if (std::isfinite(rr) && rr >= 0.f) params_.rollingResistance = rr;
}

void PhysicsWorld::getPosition(int id, float* px, float* py, float* pz) const {
  const int dense = handles_.findDenseIndex(id);
  if (dense < 0) return;
  if (px) *px = bodies_.posX(dense);
  if (py) *py = bodies_.posY(dense);
  if (pz) *pz = bodies_.posZ(dense);
}

void PhysicsWorld::getVelocity(int id, float* vx, float* vy, float* vz) const {
  BodyView b = findView(id);
  if (!b.valid()) return;
  const Vec3 v = b.getVelocity();
  if (vx) *vx = v.x;
  if (vy) *vy = v.y;
  if (vz) *vz = v.z;
}

void PhysicsWorld::getAngularVelocity(int id, float* wx, float* wy, float* wz) const {
  BodyView b = findView(id);
  if (!b.valid()) return;
  const Vec3 w = b.getAngularVelocity();
  if (wx) *wx = w.x;
  if (wy) *wy = w.y;
  if (wz) *wz = w.z;
}

void PhysicsWorld::getRotation(int id, float* qx, float* qy, float* qz, float* qw) const {
  BodyView b = findView(id);
  if (!b.valid()) return;
  const Quat q = b.getRotation();
  if (qx) *qx = q.x;
  if (qy) *qy = q.y;
  if (qz) *qz = q.z;
  if (qw) *qw = q.w;
}

} // namespace pachinball
