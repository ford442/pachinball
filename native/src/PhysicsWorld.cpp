#include "PhysicsWorld.h"
#include "HingeJoint.h"
#include <cmath>
#include <algorithm>
#include <cstdlib>

namespace pachinball {

static constexpr float CONTACT_EPSILON_SQ = 1e-10f;

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
  BoxDesc box{{px, py, pz}, {hx, hy, hz}, {qx, qy, qz, qw}, restitution, friction};
  boxes_.push_back(box);
  const int idx = static_cast<int>(boxes_.size()) - 1;
  broadphase_.insertStaticBox(idx, box);
  return STATIC_BOX_ID_BASE - idx;
}

int PhysicsWorld::addStaticCapsule(float px, float py, float pz,
                                   float radius, float halfHeight,
                                   float qx, float qy, float qz, float qw,
                                   float restitution, float friction) {
  CapsuleDesc cap{{px, py, pz}, radius, halfHeight, {qx, qy, qz, qw}, restitution, friction};
  capsules_.push_back(cap);
  const int idx = static_cast<int>(capsules_.size()) - 1;
  broadphase_.insertStaticCapsule(idx, cap);
  return STATIC_CAPSULE_ID_BASE - idx;
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

  broadphase_.buildPairs(bodies_, pairs_);

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

namespace {

struct ContactSide {
  BodyView* body = nullptr;
  Vec3 r = Vec3::zero();
  float invMass = 0.f;
  float invInertia = 0.f;
};

Vec3 sidePointVel(const ContactSide& s) {
  if (!s.body || !s.body->valid()) return Vec3::zero();
  return s.body->getVelocity() + s.body->getAngularVelocity().cross(s.r);
}

float sideAngularDenom(const ContactSide& s, const Vec3& dir) {
  if (s.invInertia <= 0.f) return 0.f;
  return s.invInertia * s.r.cross(dir).lengthSq();
}

void sideApplyImpulse(ContactSide& s, const Vec3& impulse) {
  if (!s.body || !s.body->valid()) return;
  s.body->applyImpulseAt(impulse, s.body->getPosition() + s.r);
}

ContactSide makeSide(BodyView* body, const Vec3& contactPoint) {
  ContactSide s;
  if (!body || !body->valid()) return s;
  s.body = body;
  s.r = contactPoint - body->getPosition();
  s.invMass = body->getInvMass();
  s.invInertia = body->getInvInertia();
  return s;
}

} // namespace

float PhysicsWorld::applyContactImpulse(BodyView& a, BodyView* b,
                                        const Vec3& contactPoint, const Vec3& normal,
                                        float restitution, float friction,
                                        float penetration) {
  wakeOnContact(a, b);

  ContactSide sa = makeSide(&a, contactPoint);
  ContactSide sb = makeSide(b, contactPoint);

  Vec3 relVel = sidePointVel(sa) - sidePointVel(sb);
  float vn = relVel.dot(normal);
  if (vn > 0.f && penetration <= 0.f) return 0.f;

  constexpr float RESTITUTION_THRESHOLD = 1.0f;
  const float e = (vn > -RESTITUTION_THRESHOLD) ? 0.f : restitution;

  const float kn = sa.invMass + sb.invMass
                 + sideAngularDenom(sa, normal)
                 + sideAngularDenom(sb, normal);
  if (kn < 1e-12f) return 0.f;

  float jn = 0.f;
  if (vn < 0.f) {
    jn = -(1.f + e) * vn / kn;
    if (jn < 0.f) jn = 0.f;
  }

  sideApplyImpulse(sa, normal * jn);
  sideApplyImpulse(sb, normal * -jn);

  float jnFriction = jn;
  constexpr float SLOP = 0.001f;
  if (penetration > SLOP) {
    const float biasVel = 0.8f * (penetration - SLOP) / std::max(params_.fixedTimestep, 1e-5f);
    jnFriction = std::max(jnFriction, biasVel / kn);
  }

  relVel = sidePointVel(sa) - sidePointVel(sb);
  Vec3 vt = relVel - normal * relVel.dot(normal);
  const float vtLen = vt.length();
  const float mu = friction;
  if (vtLen > 1e-8f && mu > 0.f && jnFriction > 0.f) {
    const Vec3 t = vt / vtLen;
    const float kt = sa.invMass + sb.invMass
                   + sideAngularDenom(sa, t)
                   + sideAngularDenom(sb, t);
    if (kt > 1e-12f) {
      float jt = -vtLen / kt;
      const float maxJt = mu * jnFriction;
      if (jt >  maxJt) jt =  maxJt;
      if (jt < -maxJt) jt = -maxJt;
      sideApplyImpulse(sa, t * jt);
      sideApplyImpulse(sb, t * -jt);
    }
  }

  const float rr = params_.rollingResistance;
  const float jnResist = std::max(jn, jnFriction);
  if (rr > 0.f && jnResist > 0.f) {
    auto applyRolling = [&](ContactSide& s) {
      if (!s.body || !s.body->valid() || s.invInertia <= 0.f) return;
      const Vec3 w = s.body->getAngularVelocity();
      const Vec3 wTan = w - normal * w.dot(normal);
      const float wLen = wTan.length();
      const float rLen = s.r.length();
      if (wLen > 1e-6f && rLen > 1e-6f) {
        const float maxTau = rr * jnResist * rLen;
        const float tau = std::min(maxTau, wLen / s.invInertia);
        s.body->applyTorqueImpulse((wTan / wLen) * -tau);
      }
      const Vec3 v = s.body->getVelocity();
      const Vec3 vTan = v - normal * v.dot(normal);
      const float vLen = vTan.length();
      if (vLen > 1e-6f && s.invMass > 0.f) {
        const float linMag = std::min(rr * jnResist, vLen / s.invMass);
        s.body->applyImpulse((vTan / vLen) * -linMag);
      }
    };
    applyRolling(sa);
    applyRolling(sb);
  }

  return jn;
}

void PhysicsWorld::resolveSphereVsSphere(BodyView& a, BodyView& b) {
  Vec3 delta = a.getPosition() - b.getPosition();
  float distSq = delta.lengthSq();
  float minDist = a.getRadius() + b.getRadius();

  if (distSq >= minDist * minDist || distSq < CONTACT_EPSILON_SQ) return;

  float dist   = std::sqrt(distSq);
  Vec3  normal = delta / dist;

  Vec3  relVel    = a.getVelocity() - b.getVelocity();
  float velAlongN = relVel.dot(normal);
  if (velAlongN > 0.5f) return;

  float e    = std::min(a.getRestitution(), b.getRestitution());
  float invA = a.getInvMass();
  float invB = b.getInvMass();
  float denom = invA + invB;
  if (denom < 1e-12f) return;

  const Vec3 contactPoint = a.getPosition() - normal * a.getRadius();
  const float mu = std::sqrt(std::max(a.getFriction(), 0.f) * std::max(b.getFriction(), 0.f));
  const float penetration = minDist - dist;
  float j = applyContactImpulse(a, &b, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.4f;
  if (penetration > SLOP) {
    float corr = (penetration - SLOP) * CORRECT / denom;
    if (a.getType() == BodyType::Dynamic)
      a.setPosition(a.getPosition() + normal * (corr * invA));
    if (b.getType() == BodyType::Dynamic)
      b.setPosition(b.getPosition() - normal * (corr * invB));
  }

  ContactEvent evt;
  evt.bodyId1 = a.getId();
  evt.bodyId2 = b.getId();
  evt.normal  = normal;
  evt.point   = a.getPosition() - normal * a.getRadius();
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveSphereVsPlane(BodyView& body, const PlaneDesc& plane) {
  float dist = body.getPosition().dot(plane.normal) - plane.distance;
  float penetration = body.getRadius() - dist;
  if (penetration <= 0.f) return;

  Vec3  vel    = body.getVelocity();
  float velN   = vel.dot(plane.normal);
  if (velN >= 0.5f) return;

  float e = body.getRestitution();
  const Vec3 contactPoint = body.getPosition() - plane.normal * body.getRadius();
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(plane.friction, 0.f));
  float j = applyContactImpulse(body, nullptr, contactPoint, plane.normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(
        body.getPosition() + plane.normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = STATIC_PLANE_ID;
  evt.normal  = plane.normal;
  evt.point   = body.getPosition() - plane.normal * body.getRadius();
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveSphereVsBox(BodyView& body, const BoxDesc& box, int boxId) {
  const Quat invRot = box.rotation.conjugate();
  const Vec3 localCenter = invRot.rotate(body.getPosition() - box.center);

  Vec3 closest{
    std::clamp(localCenter.x, -box.halfExtents.x, box.halfExtents.x),
    std::clamp(localCenter.y, -box.halfExtents.y, box.halfExtents.y),
    std::clamp(localCenter.z, -box.halfExtents.z, box.halfExtents.z),
  };

  Vec3 delta = localCenter - closest;
  float distSq = delta.lengthSq();
  float radius = body.getRadius();

  if (distSq >= radius * radius) return;

  Vec3 normal;
  float penetration;
  if (distSq < CONTACT_EPSILON_SQ) {
    const float dx = box.halfExtents.x - std::fabs(localCenter.x);
    const float dy = box.halfExtents.y - std::fabs(localCenter.y);
    const float dz = box.halfExtents.z - std::fabs(localCenter.z);
    Vec3 localNormal = Vec3::up();
    float shallow = dy;
    if (dx < shallow) { shallow = dx; localNormal = {localCenter.x >= 0.f ? 1.f : -1.f, 0.f, 0.f}; }
    if (dz < shallow) { localNormal = {0.f, 0.f, localCenter.z >= 0.f ? 1.f : -1.f}; }
    normal = box.rotation.rotate(localNormal).normalized();
    penetration = radius + shallow;
  } else {
    float dist = std::sqrt(distSq);
    Vec3 localNormal = delta / dist;
    normal = box.rotation.rotate(localNormal);
    penetration = radius - dist;
  }

  Vec3 vel = body.getVelocity();
  float velN = vel.dot(normal);
  if (velN >= 0.5f) return;

  float e = std::min(body.getRestitution(), box.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * radius;
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(box.friction, 0.f));
  float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = boxId;
  evt.normal  = normal;
  evt.point   = body.getPosition() - normal * radius;
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

Vec3 PhysicsWorld::closestPointOnSegment(const Vec3& p, const Vec3& segA, const Vec3& segB) {
  const Vec3 ab = segB - segA;
  float t = 0.f;
  const float abLenSq = ab.lengthSq();
  if (abLenSq > CONTACT_EPSILON_SQ) {
    t = std::clamp((p - segA).dot(ab) / abLenSq, 0.f, 1.f);
  }
  return segA + ab * t;
}

void PhysicsWorld::resolveSphereVsCapsule(BodyView& body, const CapsuleDesc& cap, int capId) {
  const Vec3 axisHalf = cap.rotation.rotate(Vec3{0.f, cap.halfHeight, 0.f});
  const Vec3 segA = cap.center - axisHalf;
  const Vec3 segB = cap.center + axisHalf;
  const Vec3 closest = closestPointOnSegment(body.getPosition(), segA, segB);

  Vec3 delta = body.getPosition() - closest;
  float distSq = delta.lengthSq();
  float minDist = body.getRadius() + cap.radius;

  if (distSq >= minDist * minDist) return;

  float dist = std::sqrt(std::max(distSq, CONTACT_EPSILON_SQ));
  Vec3 normal = dist > 1e-5f ? delta / dist
                              : cap.rotation.rotate(Vec3{0.f, 1.f, 0.f}).normalized();
  float penetration = minDist - dist;

  Vec3 vel = body.getVelocity();
  float velN = vel.dot(normal);
  if (velN >= 0.5f) return;

  float e = std::min(body.getRestitution(), cap.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * body.getRadius();
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(cap.friction, 0.f));
  float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = capId;
  evt.normal  = normal;
  evt.point   = body.getPosition() - normal * body.getRadius();
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveSphereVsCapsuleBody(BodyView& sphere, BodyView& capsule) {
  const Vec3 axisHalf = capsule.getRotation().rotate(Vec3{0.f, capsule.getCapsuleHalfHeight(), 0.f});
  const Vec3 segA = capsule.getPosition() - axisHalf;
  const Vec3 segB = capsule.getPosition() + axisHalf;
  const Vec3 closest = closestPointOnSegment(sphere.getPosition(), segA, segB);

  Vec3 delta = sphere.getPosition() - closest;
  float distSq = delta.lengthSq();
  float minDist = sphere.getRadius() + capsule.getRadius();

  if (distSq >= minDist * minDist) return;

  float dist = std::sqrt(std::max(distSq, CONTACT_EPSILON_SQ));
  Vec3 normal = dist > 1e-5f ? delta / dist
                             : capsule.getRotation().rotate(Vec3{0.f, 1.f, 0.f}).normalized();
  float penetration = minDist - dist;

  Vec3 relVel = sphere.getVelocity() - capsule.getVelocity();
  float velAlongN = relVel.dot(normal);
  if (velAlongN >= 0.5f) return;

  float e = std::min(sphere.getRestitution(), capsule.getRestitution());
  float invSphere = sphere.getInvMass();
  float invCapsule = capsule.getInvMass();
  float denom = invSphere + invCapsule;
  if (denom < 1e-12f && sphere.getType() != BodyType::Dynamic) return;

  const Vec3 contactPoint = sphere.getPosition() - normal * sphere.getRadius();
  const float mu = std::sqrt(std::max(sphere.getFriction(), 0.f) * std::max(capsule.getFriction(), 0.f));
  float j = applyContactImpulse(sphere, &capsule, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP) {
    const float posDenom = std::max(invSphere + invCapsule, 1e-12f);
    if (sphere.getType() == BodyType::Dynamic)
      sphere.setPosition(sphere.getPosition() + normal * ((penetration - SLOP) * CORRECT * invSphere / posDenom));
    if (capsule.getType() == BodyType::Dynamic)
      capsule.setPosition(capsule.getPosition() - normal * ((penetration - SLOP) * CORRECT * invCapsule / posDenom));
  }

  ContactEvent evt;
  evt.bodyId1 = sphere.getId();
  evt.bodyId2 = capsule.getId();
  evt.normal  = normal;
  evt.point   = sphere.getPosition() - normal * sphere.getRadius();
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
