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

void PhysicsWorld::setBodyPosition(int id, float px, float py, float pz) {
  RigidBody* b = findBody(id);
  if (b) b->setPosition({px, py, pz});
}

void PhysicsWorld::setBodyRotation(int id, float qx, float qy, float qz, float qw) {
  RigidBody* b = findBody(id);
  if (b) b->setRotation({qx, qy, qz, qw});
}

// ---- Static geometry ----------------------------------------------------

void PhysicsWorld::addStaticPlane(float nx, float ny, float nz, float distance) {
  planes_.push_back({{nx, ny, nz}, distance});
}

int PhysicsWorld::addStaticBox(float px, float py, float pz,
                               float hx, float hy, float hz,
                               float qx, float qy, float qz, float qw,
                               float restitution) {
  boxes_.push_back({
    {px, py, pz},
    {hx, hy, hz},
    {qx, qy, qz, qw},
    restitution
  });
  return STATIC_BOX_ID_BASE - static_cast<int>(boxes_.size()) + 1;
}

int PhysicsWorld::addStaticCapsule(float px, float py, float pz,
                                   float radius, float halfHeight,
                                   float qx, float qy, float qz, float qw,
                                   float restitution) {
  capsules_.push_back({
    {px, py, pz},
    radius,
    halfHeight,
    {qx, qy, qz, qw},
    restitution
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
        resolveSphereVsSphere(a, b);
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

  // Already separating
  if (velAlongN > 0.f) return;

  float e    = std::min(a.getRestitution(), b.getRestitution());
  float invA = a.getInvMass();
  float invB = b.getInvMass();
  float denom = invA + invB;
  if (denom < 1e-12f) return;

  float j       = -(1.f + e) * velAlongN / denom;
  Vec3  impulse = normal * j;

  a.applyImpulse( impulse);
  b.applyImpulse(impulse * -1.f);

  // Baumgarte position correction:
  //   SLOP    — allowable penetration depth before correction activates.
  //   CORRECT — fraction of remaining penetration resolved per substep (0–1).
  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.4f;
  float penetration = minDist - dist;
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
  if (velN >= 0.f) return; // Moving away from or along the plane

  float e       = body.getRestitution();
  float invMass = body.getInvMass();
  float j       = -(1.f + e) * velN;  // invMass of static plane = 0

  body.applyImpulse(plane.normal * j);

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
  if (velN >= 0.f) return;

  float e = std::min(body.getRestitution(), box.restitution);
  float j = -(1.f + e) * velN;
  body.applyImpulse(normal * j);

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

void PhysicsWorld::resolveSphereVsCapsule(RigidBody& body, const CapsuleDesc& cap, int capId) {
  const Vec3 axisHalf = cap.rotation.rotate(Vec3{0.f, cap.halfHeight, 0.f});
  const Vec3 segA = cap.center - axisHalf;
  const Vec3 segB = cap.center + axisHalf;
  const Vec3 ab = segB - segA;

  float t = 0.f;
  const float abLenSq = ab.lengthSq();
  if (abLenSq > CONTACT_EPSILON_SQ) {
    t = std::clamp((body.getPosition() - segA).dot(ab) / abLenSq, 0.f, 1.f);
  }
  const Vec3 closest = segA + ab * t;

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
  if (velN >= 0.f) return;

  float e = std::min(body.getRestitution(), cap.restitution);
  float j = -(1.f + e) * velN;
  body.applyImpulse(normal * j);

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

} // namespace pachinball
