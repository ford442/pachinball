#include "PhysicsWorld.h"
#include <cmath>
#include <algorithm>

namespace pachinball {

// Minimum squared distance between sphere centres before we skip collision
// detection (prevents division by near-zero when bodies are exactly coincident).
static constexpr float CONTACT_EPSILON_SQ = 1e-10f;

// ---- Constructor --------------------------------------------------------

PhysicsWorld::PhysicsWorld(const WorldParams& params)
    : params_(params) {}

// ---- Body management ----------------------------------------------------

int PhysicsWorld::createRigidBody(const RigidBodyDesc& desc) {
  int id = nextId_++;
  bodies_.push_back(std::make_unique<RigidBody>(id, desc));
  return id;
}

void PhysicsWorld::removeRigidBody(int id) {
  for (auto it = bodies_.begin(); it != bodies_.end(); ++it) {
    if ((*it)->getId() == id) {
      bodies_.erase(it);
      return;
    }
  }
}

void PhysicsWorld::applyForce(int id, float fx, float fy, float fz) {
  RigidBody* b = findBody(id);
  if (b) b->applyForce({fx, fy, fz});
}

void PhysicsWorld::applyImpulse(int id, float ix, float iy, float iz) {
  RigidBody* b = findBody(id);
  if (b) b->applyImpulse({ix, iy, iz});
}

void PhysicsWorld::setVelocity(int id, float vx, float vy, float vz) {
  RigidBody* b = findBody(id);
  if (b) b->setVelocity({vx, vy, vz});
}

void PhysicsWorld::setAngularVelocity(int id, float wx, float wy, float wz) {
  RigidBody* b = findBody(id);
  if (b) b->setAngularVelocity({wx, wy, wz});
}

void PhysicsWorld::setBodyPosition(int id, float px, float py, float pz) {
  RigidBody* b = findBody(id);
  if (b) b->setPosition({px, py, pz});
}

void PhysicsWorld::setBodyRotation(int id, float qx, float qy, float qz, float qw) {
  RigidBody* b = findBody(id);
  if (b) b->setRotation({qx, qy, qz, qw});
}

// ---- Static geometry ----------------------------------------------------

void PhysicsWorld::addStaticPlane(float nx, float ny, float nz, float distance, float friction) {
  planes_.push_back({{nx, ny, nz}, distance, friction});
}

int PhysicsWorld::addStaticBox(float px, float py, float pz,
                               float hx, float hy, float hz,
                               float qx, float qy, float qz, float qw,
                               float restitution, float friction) {
  boxes_.push_back({
    {px, py, pz},
    {hx, hy, hz},
    {qx, qy, qz, qw},
    restitution,
    friction
  });
  return STATIC_BOX_ID_BASE - static_cast<int>(boxes_.size()) + 1;
}

int PhysicsWorld::addStaticCapsule(float px, float py, float pz,
                                   float radius, float halfHeight,
                                   float qx, float qy, float qz, float qw,
                                   float restitution, float friction) {
  capsules_.push_back({
    {px, py, pz},
    radius,
    halfHeight,
    {qx, qy, qz, qw},
    restitution,
    friction
  });
  return STATIC_CAPSULE_ID_BASE - static_cast<int>(capsules_.size()) + 1;
}

// ---- Transform queries --------------------------------------------------

void PhysicsWorld::getPosition(int id, float* px, float* py, float* pz) const {
  const RigidBody* b = findBody(id);
  if (b) {
    *px = b->getPosition().x;
    *py = b->getPosition().y;
    *pz = b->getPosition().z;
  }
}

void PhysicsWorld::getVelocity(int id, float* vx, float* vy, float* vz) const {
  const RigidBody* b = findBody(id);
  if (b) {
    *vx = b->getVelocity().x;
    *vy = b->getVelocity().y;
    *vz = b->getVelocity().z;
  }
}

void PhysicsWorld::getAngularVelocity(int id, float* wx, float* wy, float* wz) const {
  const RigidBody* b = findBody(id);
  if (b) {
    *wx = b->getAngularVelocity().x;
    *wy = b->getAngularVelocity().y;
    *wz = b->getAngularVelocity().z;
  }
}

void PhysicsWorld::getRotation(int id, float* qx, float* qy, float* qz, float* qw) const {
  const RigidBody* b = findBody(id);
  if (b) {
    *qx = b->getRotation().x;
    *qy = b->getRotation().y;
    *qz = b->getRotation().z;
    *qw = b->getRotation().w;
  }
}

// ---- Simulation step ----------------------------------------------------

float PhysicsWorld::step(float rawDt) {
  // Cap dt to avoid explosions during lag spikes
  constexpr float MAX_DT = 1.f / 30.f;
  float dt = (rawDt < MAX_DT) ? rawDt : MAX_DT;

  accumulator_ += dt;

  int substepsDone = 0;
  while (accumulator_ >= params_.fixedTimestep &&
         substepsDone < (int)params_.maxSubsteps) {
    substep(params_.fixedTimestep);
    accumulator_ -= params_.fixedTimestep;
    ++substepsDone;
    ++stepCount_;
  }

  // Flush contact events once per step call
  contactListener_.flushEvents();

  // Interpolation alpha for visual smoothing
  return accumulator_ / params_.fixedTimestep;
}

int PhysicsWorld::getActiveBodyCount() const {
  int count = 0;
  for (const auto& b : bodies_) {
    if (b->isActive()) ++count;
  }
  return count;
}

// ---- Private helpers ----------------------------------------------------

RigidBody* PhysicsWorld::findBody(int id) {
  for (auto& b : bodies_) {
    if (b->getId() == id) return b.get();
  }
  return nullptr;
}

const RigidBody* PhysicsWorld::findBody(int id) const {
  for (const auto& b : bodies_) {
    if (b->getId() == id) return b.get();
  }
  return nullptr;
}

void PhysicsWorld::substep(float dt) {
  // 1. Integrate forces → update velocities + positions
  for (auto& b : bodies_) {
    b->integrate(dt, params_.gravity);
  }

  // 2. Collision detection & response (sequential impulse, single pass)
  for (int iter = 0; iter < params_.solverIterations; ++iter) {
    // Dynamic vs Dynamic
    for (std::size_t i = 0; i < bodies_.size(); ++i) {
      for (std::size_t j = i + 1; j < bodies_.size(); ++j) {
        RigidBody& a = *bodies_[i];
        RigidBody& b = *bodies_[j];
        if (!a.isActive() || !b.isActive()) continue;
        if (a.getType() == BodyType::Static && b.getType() == BodyType::Static) continue;

        const bool aCapsule = a.getShape() == Shape::Capsule;
        const bool bCapsule = b.getShape() == Shape::Capsule;
        if (aCapsule && bCapsule) {
          // Capsule-vs-capsule (e.g. two flipper proxies) is not needed for any
          // current gameplay scenario — explicit non-goal for Phase 2c-A.
          continue;
        } else if (aCapsule) {
          resolveSphereVsCapsuleBody(b, a);
        } else if (bCapsule) {
          resolveSphereVsCapsuleBody(a, b);
        } else {
          resolveSphereVsSphere(a, b);
        }
      }
    }

    // Dynamic vs Static planes
    for (auto& body : bodies_) {
      if (!body->isActive() || body->getType() == BodyType::Static) continue;
      for (const auto& plane : planes_) {
        resolveSphereVsPlane(*body, plane);
      }
    }

    // Dynamic vs Static boxes
    for (std::size_t bi = 0; bi < boxes_.size(); ++bi) {
      const int boxId = STATIC_BOX_ID_BASE - static_cast<int>(bi);
      for (auto& body : bodies_) {
        if (!body->isActive() || body->getType() == BodyType::Static) continue;
        resolveSphereVsBox(*body, boxes_[bi], boxId);
      }
    }

    // Dynamic vs Static capsules
    for (std::size_t ci = 0; ci < capsules_.size(); ++ci) {
      const int capId = STATIC_CAPSULE_ID_BASE - static_cast<int>(ci);
      for (auto& body : bodies_) {
        if (!body->isActive() || body->getType() == BodyType::Static) continue;
        resolveSphereVsCapsule(*body, capsules_[ci], capId);
      }
    }
  }
}

// ---- Contact solver -----------------------------------------------------
//
// Friction combine: geometric mean μ = sqrt(μ_a * μ_b).
// Restitution combine: min(e_a, e_b) (handled by callers).
// Contact-point velocity includes ω × r so a spinning sphere (or a kinematic
// flipper proxy with angular velocity) participates in the tangential term.

namespace {

struct ContactSide {
  RigidBody* body = nullptr;
  Vec3 r = Vec3::zero();
  float invMass = 0.f;
  float invInertia = 0.f;
};

Vec3 sidePointVel(const ContactSide& s) {
  if (!s.body) return Vec3::zero();
  return s.body->getVelocity() + s.body->getAngularVelocity().cross(s.r);
}

float sideAngularDenom(const ContactSide& s, const Vec3& dir) {
  if (s.invInertia <= 0.f) return 0.f;
  return s.invInertia * s.r.cross(dir).lengthSq();
}

void sideApplyImpulse(ContactSide& s, const Vec3& impulse) {
  if (!s.body) return;
  s.body->applyImpulseAt(impulse, s.body->getPosition() + s.r);
}

ContactSide makeSide(RigidBody* body, const Vec3& contactPoint) {
  ContactSide s;
  if (!body) return s;
  s.body = body;
  s.r = contactPoint - body->getPosition();
  s.invMass = body->getInvMass();
  s.invInertia = body->getInvInertia();
  return s;
}

} // namespace

float PhysicsWorld::applyContactImpulse(RigidBody& a, RigidBody* b,
                                        const Vec3& contactPoint, const Vec3& normal,
                                        float restitution, float friction,
                                        float penetration) {
  ContactSide sa = makeSide(&a, contactPoint);
  ContactSide sb = makeSide(b, contactPoint);

  Vec3 relVel = sidePointVel(sa) - sidePointVel(sb);
  float vn = relVel.dot(normal);
  // Clearly receding and not overlapping — nothing to do.
  if (vn > 0.f && penetration <= 0.f) return 0.f;

  // Bounce only above a speed threshold so resting contacts settle.
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

  // Overlapping contacts with little/no approach (kinematic sweepers, resting
  // overlap) still need a non-empty Coulomb cone. Bias from overlap / dt so a
  // 2 cm interpenetration yields ~O(1) impulse at 60 Hz.
  float jnFriction = jn;
  constexpr float SLOP = 0.001f;
  if (penetration > SLOP) {
    const float biasVel = 0.8f * (penetration - SLOP) / std::max(params_.fixedTimestep, 1e-5f);
    jnFriction = std::max(jnFriction, biasVel / kn);
  }

  // Coulomb friction: cancel as much tangential velocity as μ jn allows.
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

  // Rolling resistance: extra couple + matching linear impulse opposing
  // residual spin / tangential COM velocity, scaled by the normal impulse.
  const float rr = params_.rollingResistance;
  const float jnResist = std::max(jn, jnFriction);
  if (rr > 0.f && jnResist > 0.f) {
    auto applyRolling = [&](ContactSide& s) {
      if (!s.body || s.invInertia <= 0.f) return;
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

void PhysicsWorld::resolveSphereVsSphere(RigidBody& a, RigidBody& b) {
  Vec3 delta = a.getPosition() - b.getPosition();
  float distSq = delta.lengthSq();
  float minDist = a.getRadius() + b.getRadius();

  if (distSq >= minDist * minDist || distSq < CONTACT_EPSILON_SQ) return;

  float dist   = std::sqrt(distSq);
  Vec3  normal = delta / dist;  // from b to a

  // ---- Relative velocity along the contact normal ----
  Vec3  relVel    = a.getVelocity() - b.getVelocity();
  float velAlongN = relVel.dot(normal);

  // Already separating (linear-only check is a cheap reject; the solver
  // re-evaluates with ω × r).
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

  // Baumgarte position correction:
  //   SLOP    — allowable penetration depth before correction activates.
  //   CORRECT — fraction of remaining penetration resolved per substep (0–1).
  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.4f;
  if (penetration > SLOP) {
    float corr = (penetration - SLOP) * CORRECT / denom;
    if (a.getType() == BodyType::Dynamic)
      a.setPosition(a.getPosition() + normal * (corr * invA));
    if (b.getType() == BodyType::Dynamic)
      b.setPosition(b.getPosition() - normal * (corr * invB));
  }

  // ---- Emit contact event ----
  ContactEvent evt;
  evt.bodyId1   = a.getId();
  evt.bodyId2   = b.getId();
  evt.normal    = normal;
  evt.point     = a.getPosition() - normal * a.getRadius();
  evt.impulse   = j;
  evt.isEntering = true;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveSphereVsPlane(RigidBody& body, const PlaneDesc& plane) {
  // Signed distance from sphere centre to plane
  float dist = body.getPosition().dot(plane.normal) - plane.distance;
  float penetration = body.getRadius() - dist;
  if (penetration <= 0.f) return;

  // Reflect velocity component along plane normal
  Vec3  vel    = body.getVelocity();
  float velN   = vel.dot(plane.normal);
  if (velN >= 0.5f) return; // Clearly receding; skip cheap

  float e = body.getRestitution();
  const Vec3 contactPoint = body.getPosition() - plane.normal * body.getRadius();
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(plane.friction, 0.f));
  float j = applyContactImpulse(body, nullptr, contactPoint, plane.normal, e, mu, penetration);

  // Baumgarte position correction:
  //   SLOP    — allowable penetration depth before correction activates.
  //   CORRECT — fraction of remaining penetration resolved per substep (0–1).
  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(
        body.getPosition() + plane.normal * ((penetration - SLOP) * CORRECT));
  }

  // ---- Emit contact event ----
  ContactEvent evt;
  evt.bodyId1   = body.getId();
  evt.bodyId2   = STATIC_PLANE_ID; // static plane
  evt.normal    = plane.normal;
  evt.point     = body.getPosition() - plane.normal * body.getRadius();
  evt.impulse   = j;
  evt.isEntering = true;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveSphereVsBox(RigidBody& body, const BoxDesc& box, int boxId) {
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
    // Sphere centre is inside the box — push out along the shallowest axis.
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
  evt.bodyId1    = body.getId();
  evt.bodyId2    = boxId;
  evt.normal     = normal;
  evt.point      = body.getPosition() - normal * radius;
  evt.impulse    = j;
  evt.isEntering = true;
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

void PhysicsWorld::resolveSphereVsCapsule(RigidBody& body, const CapsuleDesc& cap, int capId) {
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
  evt.bodyId1    = body.getId();
  evt.bodyId2    = capId;
  evt.normal     = normal;
  evt.point      = body.getPosition() - normal * body.getRadius();
  evt.impulse    = j;
  evt.isEntering = true;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveSphereVsCapsuleBody(RigidBody& sphere, RigidBody& capsule) {
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

  // Relative velocity along the contact normal — unlike the static-geometry path,
  // the capsule's own velocity participates here so a moving kinematic capsule
  // (e.g. a flipper proxy) imparts correct momentum onto the sphere.
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
  evt.bodyId1    = sphere.getId();
  evt.bodyId2    = capsule.getId();
  evt.normal     = normal;
  evt.point      = sphere.getPosition() - normal * sphere.getRadius();
  evt.impulse    = j;
  evt.isEntering = true;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
