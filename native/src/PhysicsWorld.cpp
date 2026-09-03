#include "PhysicsWorld.h"
#include "HingeJoint.h"
#include "KinematicMover.h"
#include <cmath>
#include <algorithm>
#include <cstdlib>

namespace pachinball {

PhysicsWorld::PhysicsWorld(const WorldParams& params)
    : params_(params) {}

PhysicsWorld::~PhysicsWorld() {
  freeTransformBuffer();
}

void PhysicsWorld::freeTransformBuffer() {
  if (transformBuffer_) {
    std::free(transformBuffer_);
    transformBuffer_ = nullptr;
    transformCapSlots_ = 0;
  }
}

void PhysicsWorld::ensureTransformCapacity(int slotCount) {
  if (slotCount <= static_cast<int>(transformCapSlots_)) return;
  std::size_t bytes = static_cast<std::size_t>(slotCount) *
                      static_cast<std::size_t>(TRANSFORM_STRIDE) * sizeof(float);
  bytes = (bytes + 15u) & ~std::size_t(15);
  void* p = std::aligned_alloc(16, bytes);
  if (!p) std::abort();
  if (transformBuffer_) std::free(transformBuffer_);
  transformBuffer_ = static_cast<float*>(p);
  transformCapSlots_ = bytes / (sizeof(float) * static_cast<std::size_t>(TRANSFORM_STRIDE));
}

void PhysicsWorld::scatterTransforms() {
  const int slots = handles_.nextId();
  if (slots <= 0) return;
  ensureTransformCapacity(slots);
  const std::size_t floats = static_cast<std::size_t>(slots) * static_cast<std::size_t>(TRANSFORM_STRIDE);
  std::memset(transformBuffer_, 0, floats * sizeof(float));

  for (int i = 0; i < bodies_.denseCount(); ++i) {
    const int publicId = bodies_.publicIdAt(i);
    float* slot = transformBuffer_ + static_cast<std::size_t>(publicId) * TRANSFORM_STRIDE;
    slot[0]  = static_cast<float>(publicId);
    slot[1]  = bodies_.posX(i);
    slot[2]  = bodies_.posY(i);
    slot[3]  = bodies_.posZ(i);
    slot[4]  = bodies_.view(i).getRotation().x;
    slot[5]  = bodies_.view(i).getRotation().y;
    slot[6]  = bodies_.view(i).getRotation().z;
    slot[7]  = bodies_.view(i).getRotation().w;
    slot[8]  = bodies_.velX(i);
    slot[9]  = bodies_.velY(i);
    slot[10] = bodies_.velZ(i);
    const Vec3 w = bodies_.view(i).getAngularVelocity();
    slot[11] = w.x;
    slot[12] = w.y;
    slot[13] = w.z;
    slot[14] = bodies_.isActive(i) ? 1.f : 0.f;
  }
}

int PhysicsWorld::createRigidBody(const RigidBodyDesc& desc) {
  return bodies_.create(handles_, desc);
}

void PhysicsWorld::removeRigidBody(int id) {
  for (HingeJoint& h : hinges_) {
    if (h.active && h.bodyId == id) h.active = false;
  }
  bodies_.remove(handles_, id);
}

int PhysicsWorld::createHinge(int bodyId, const HingeDesc& desc) {
  BodyView body = findViewMut(bodyId);
  if (!body.valid()) return -1;

  HingeJoint h;
  h.id = nextHingeId_++;
  h.bodyId = bodyId;
  h.active = true;
  h.worldAnchor = desc.worldAnchor;
  const float axisLen = desc.worldAxis.length();
  h.worldAxis = axisLen > 1e-8f ? desc.worldAxis / axisLen : Vec3::up();
  h.restRotation = body.getRotation();
  h.localAnchor = h.restRotation.conjugate().rotate(desc.worldAnchor - body.getPosition());
  h.minAngle = desc.minAngle;
  h.maxAngle = desc.maxAngle;
  h.motorTargetVel = desc.motorTargetVel;
  h.motorMaxTorque = desc.motorMaxTorque;
  h.baumgarte = desc.baumgarte > 0.f ? desc.baumgarte : 0.2f;
  hinges_.push_back(h);
  return h.id;
}

void PhysicsWorld::setHingeMotor(int id, float targetVel, float maxTorque) {
  for (HingeJoint& h : hinges_) {
    if (!h.active || h.id != id) continue;
    h.motorTargetVel = targetVel;
    h.motorMaxTorque = maxTorque < 0.f ? 0.f : maxTorque;
    BodyView body = findViewMut(h.bodyId);
    if (body.valid()) body.wake();
    return;
  }
}

float PhysicsWorld::getHingeAngle(int id) const {
  for (const HingeJoint& h : hinges_) {
    if (!h.active || h.id != id) continue;
    BodyView body = findView(h.bodyId);
    if (!body.valid()) return 0.f;
    return computeHingeAngle(h, body.getRotation());
  }
  return 0.f;
}

void PhysicsWorld::removeHinge(int id) {
  for (HingeJoint& h : hinges_) {
    if (h.active && h.id == id) {
      h.active = false;
      return;
    }
  }
}

void PhysicsWorld::solveHinges(float dt) {
  for (HingeJoint& h : hinges_) {
    if (!h.active) continue;
    BodyView body = findViewMut(h.bodyId);
    if (!body.valid()) {
      h.active = false;
      continue;
    }
    solveWorldHinge(h, body, dt);
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
  if (b.valid()) b.setRotation({qx, qy, qz, qw});
}

void PhysicsWorld::addStaticPlane(float nx, float ny, float nz, float distance, float friction) {
  planes_.push_back({{nx, ny, nz}, distance, friction});
}

int PhysicsWorld::addStaticBox(float px, float py, float pz,
                               float hx, float hy, float hz,
                               float qx, float qy, float qz, float qw,
                               float restitution, float friction) {
  BoxDesc box;
  box.center = {px, py, pz};
  box.halfExtents = {hx, hy, hz};
  box.rotation = {qx, qy, qz, qw};
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
  CapsuleDesc cap;
  cap.center = {px, py, pz};
  cap.radius = radius;
  cap.halfHeight = halfHeight;
  cap.rotation = {qx, qy, qz, qw};
  cap.restitution = restitution;
  cap.friction = friction;
  capsules_.push_back(cap);
  const int idx = static_cast<int>(capsules_.size()) - 1;
  broadphase_.insertStaticCapsule(idx, cap);
  return STATIC_CAPSULE_ID_BASE - idx;
}

int PhysicsWorld::addKinematicMover(const KinematicMoverDesc& desc) {
  KinematicMover mover;
  mover.halfExtents = desc.halfExtents;
  mover.currentPos = desc.position;
  mover.currentRot = desc.rotation;
  mover.nextPos = desc.position;
  mover.nextRot = desc.rotation;
  mover.restitution = desc.restitution;
  mover.friction = desc.friction;
  mover.membership = desc.membership;
  mover.filter = desc.filter;
  movers_.push_back(mover);
  const int idx = static_cast<int>(movers_.size()) - 1;
  return KINEMATIC_MOVER_ID_BASE - idx;
}

void PhysicsWorld::setNextKinematicTransform(int moverId, float px, float py, float pz,
                                             float qx, float qy, float qz, float qw) {
  const std::size_t idx = static_cast<std::size_t>(KINEMATIC_MOVER_ID_BASE - moverId);
  if (idx >= movers_.size()) return;
  movers_[idx].nextPos = {px, py, pz};
  movers_[idx].nextRot = {qx, qy, qz, qw};
  movers_[idx].hasNextPose = true;
}

int PhysicsWorld::addSensorVolume(const SensorVolumeDesc& desc) {
  sensors_.push_back(desc);
  const int idx = static_cast<int>(sensors_.size()) - 1;
  broadphase_.insertSensorVolume(idx, desc);
  return SENSOR_VOLUME_ID_BASE - idx;
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
  } else if (id <= SENSOR_VOLUME_ID_BASE) {
    const std::size_t idx = static_cast<std::size_t>(SENSOR_VOLUME_ID_BASE - id);
    if (idx < sensors_.size()) { sensors_[idx].membership = membership; sensors_[idx].filter = filter; }
  }
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

float PhysicsWorld::step(float rawDt) {
  constexpr float MAX_DT = 1.f / 30.f;
  float dt = (rawDt < MAX_DT) ? rawDt : MAX_DT;

  accumulator_ += dt;

  // Movers receive one pose push per world tick (see setNextKinematicTransform);
  // derive their velocity for this tick's substeps up front, once.
  for (KinematicMover& mover : movers_) {
    advanceKinematicMoverPose(mover, params_.fixedTimestep);
  }

  int substepsDone = 0;
  while (accumulator_ >= params_.fixedTimestep &&
         substepsDone < static_cast<int>(params_.maxSubsteps)) {
    substep(params_.fixedTimestep);
    accumulator_ -= params_.fixedTimestep;
    ++substepsDone;
    ++stepCount_;
  }

  if (substepsDone > 0) {
    contactListener_.flushEvents();
    scatterTransforms();
  }

  return accumulator_ / params_.fixedTimestep;
}

int PhysicsWorld::getActiveBodyCount() const {
  return bodies_.activeCount();
}

void PhysicsWorld::wakeOnContact(BodyView& a, BodyView* b) {
  auto wakesSleepers = [](BodyView* partner) -> bool {
    if (!partner || !partner->valid() || !partner->isActive()) return false;
    const BodyType t = partner->getType();
    return t == BodyType::Dynamic || t == BodyType::Kinematic;
  };
  if (!a.isActive() && wakesSleepers(b)) a.wake();
  if (b && b->valid() && !b->isActive() && wakesSleepers(&a)) b->wake();
}

void PhysicsWorld::substep(float dt) {
  bodies_.integrateAll(dt, params_.gravity);

  bodies_.updateSleep(params_.sleepLinearThreshold,
                      params_.sleepAngularThreshold,
                      params_.sleepFramesRequired);

  broadphase_.buildPairs(bodies_, boxes_, capsules_, sensors_, movers_, pairs_);

  for (int iter = 0; iter < params_.solverIterations; ++iter) {
    for (const auto& pair : pairs_) {
      if (pair.type == BroadphaseGrid::Pair::BodyBody) {
        BodyView a = bodies_.view(pair.bodyA);
        BodyView b = bodies_.view(pair.bodyB);
        if (!a.isActive() || !b.isActive()) continue;
        if (a.getType() == BodyType::Static && b.getType() == BodyType::Static) continue;

        const bool aCapsule = a.getShape() == Shape::Capsule;
        const bool bCapsule = b.getShape() == Shape::Capsule;
        if (aCapsule && bCapsule) continue;
        if (aCapsule) {
          resolveSphereVsCapsuleBody(b, a);
        } else if (bCapsule) {
          resolveSphereVsCapsuleBody(a, b);
        } else {
          resolveSphereVsSphere(a, b);
        }
      } else if (pair.type == BroadphaseGrid::Pair::BodyBox) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!body.isActive() || body.getType() == BodyType::Static) continue;
        const int boxId = STATIC_BOX_ID_BASE - pair.bodyB;
        resolveSphereVsBox(body, boxes_[static_cast<std::size_t>(pair.bodyB)], boxId);
      } else if (pair.type == BroadphaseGrid::Pair::BodyCapsule) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!body.isActive() || body.getType() == BodyType::Static) continue;
        const int capId = STATIC_CAPSULE_ID_BASE - pair.bodyB;
        resolveSphereVsCapsule(body, capsules_[static_cast<std::size_t>(pair.bodyB)], capId);
      } else if (pair.type == BroadphaseGrid::Pair::BodyMover) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!body.isActive() || body.getType() == BodyType::Static) continue;
        if (body.getShape() == Shape::Capsule) {
          resolveCapsuleVsMover(body, pair.bodyB);
        } else {
          resolveSphereVsMover(body, pair.bodyB);
        }
      } else if (pair.type == BroadphaseGrid::Pair::BodySensor) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!body.isActive() || body.getType() == BodyType::Static) continue;
        resolveSphereVsSensor(body, pair.bodyB);
      }
    }

    for (int i = 0; i < bodies_.denseCount(); ++i) {
      BodyView body = bodies_.view(i);
      if (!body.isActive() || body.getType() == BodyType::Static) continue;
      for (const auto& plane : planes_) {
        resolveSphereVsPlane(body, plane);
      }
    }

    solveHinges(dt);
  }
}

} // namespace pachinball
