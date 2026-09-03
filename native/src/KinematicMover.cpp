#include "KinematicMover.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

static constexpr float MOVER_EPSILON_SQ = 1e-10f;

void advanceKinematicMoverPose(KinematicMover& mover, float dt) {
  if (!mover.hasNextPose || dt <= 1e-8f) {
    mover.linearVelocity = Vec3::zero();
    mover.angularVelocity = Vec3::zero();
    return;
  }

  mover.linearVelocity = (mover.nextPos - mover.currentPos) / dt;

  // Shortest-path quaternion delta: dq = nextRot * currentRot^-1, then
  // small-angle extraction ω ≈ 2 * dq.xyz / dt.
  Quat dq = mover.nextRot * mover.currentRot.conjugate();
  if (dq.w < 0.f) dq = Quat{-dq.x, -dq.y, -dq.z, -dq.w};
  mover.angularVelocity = Vec3{dq.x, dq.y, dq.z} * (2.f / dt);

  mover.currentPos = mover.nextPos;
  mover.currentRot = mover.nextRot;
  mover.hasNextPose = false;
}

float PhysicsWorld::applyMoverContactImpulse(BodyView& body, const Vec3& contactPoint,
                                             const Vec3& normal, const Vec3& otherPointVel,
                                             float restitution, float friction,
                                             float penetration) {
  if (!body.isActive()) body.wake();

  const Vec3 r = contactPoint - body.getPosition();
  const float invMass = body.getInvMass();
  const float invInertia = body.getInvInertia();

  auto pointVel = [&]() { return body.getVelocity() + body.getAngularVelocity().cross(r); };

  Vec3 relVel = pointVel() - otherPointVel;
  float vn = relVel.dot(normal);
  if (vn > 0.f && penetration <= 0.f) return 0.f;

  constexpr float RESTITUTION_THRESHOLD = 1.0f;
  const float e = (vn > -RESTITUTION_THRESHOLD) ? 0.f : restitution;

  const float angDenom = invInertia > 0.f ? invInertia * r.cross(normal).lengthSq() : 0.f;
  const float kn = invMass + angDenom;
  if (kn < 1e-12f) return 0.f;

  float jn = 0.f;
  if (vn < 0.f) {
    jn = -(1.f + e) * vn / kn;
    if (jn < 0.f) jn = 0.f;
  }
  body.applyImpulseAt(normal * jn, contactPoint);

  float jnFriction = jn;
  constexpr float SLOP = 0.001f;
  if (penetration > SLOP) {
    const float biasVel = 0.8f * (penetration - SLOP) / std::max(params_.fixedTimestep, 1e-5f);
    jnFriction = std::max(jnFriction, biasVel / kn);
  }

  relVel = pointVel() - otherPointVel;
  Vec3 vt = relVel - normal * relVel.dot(normal);
  const float vtLen = vt.length();
  if (vtLen > 1e-8f && friction > 0.f && jnFriction > 0.f) {
    const Vec3 t = vt / vtLen;
    const float angDenomT = invInertia > 0.f ? invInertia * r.cross(t).lengthSq() : 0.f;
    const float kt = invMass + angDenomT;
    if (kt > 1e-12f) {
      float jt = -vtLen / kt;
      const float maxJt = friction * jnFriction;
      jt = std::clamp(jt, -maxJt, maxJt);
      body.applyImpulseAt(t * jt, contactPoint);
    }
  }

  return jn;
}

/** Closest point on an OBB (given as local half-extents) to a local-space point, clamped per axis. */
static Vec3 clampToHalfExtents(const Vec3& local, const Vec3& he) {
  return {
    std::clamp(local.x, -he.x, he.x),
    std::clamp(local.y, -he.y, he.y),
    std::clamp(local.z, -he.z, he.z),
  };
}

/** Shallowest-face normal + penetration for a point known to be inside the OBB (deep contact). */
static void deepestFaceNormal(const Vec3& local, const Vec3& he, Vec3& outLocalNormal, float& outShallow) {
  const float dx = he.x - std::fabs(local.x);
  const float dy = he.y - std::fabs(local.y);
  const float dz = he.z - std::fabs(local.z);
  outLocalNormal = Vec3::up();
  outShallow = dy;
  if (dx < outShallow) { outShallow = dx; outLocalNormal = {local.x >= 0.f ? 1.f : -1.f, 0.f, 0.f}; }
  if (dz < outShallow) { outShallow = dz; outLocalNormal = {0.f, 0.f, local.z >= 0.f ? 1.f : -1.f}; }
}

void PhysicsWorld::resolveSphereVsMover(BodyView& body, int moverIndex) {
  KinematicMover& mover = movers_[static_cast<std::size_t>(moverIndex)];
  if (!groupsInteract(body.getMembership(), body.getFilter(), mover.membership, mover.filter)) return;

  const Quat invRot = mover.currentRot.conjugate();
  const Vec3 localCenter = invRot.rotate(body.getPosition() - mover.currentPos);
  const Vec3 closest = clampToHalfExtents(localCenter, mover.halfExtents);

  const Vec3 delta = localCenter - closest;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (distSq >= radius * radius) return;

  Vec3 localNormal;
  float penetration;
  if (distSq < MOVER_EPSILON_SQ) {
    float shallow;
    deepestFaceNormal(localCenter, mover.halfExtents, localNormal, shallow);
    penetration = radius + shallow;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    penetration = radius - dist;
  }

  const Vec3 normal = mover.currentRot.rotate(localNormal).normalized();
  const Vec3 contactPoint = body.getPosition() - normal * radius;
  const Vec3 moverArm = contactPoint - mover.currentPos;
  const Vec3 moverPointVel = mover.linearVelocity + mover.angularVelocity.cross(moverArm);

  const float e = std::min(body.getRestitution(), mover.restitution);
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(mover.friction, 0.f));
  const float j = applyMoverContactImpulse(body, contactPoint, normal, moverPointVel, e, mu, penetration);

  constexpr float SLOP = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = KINEMATIC_MOVER_ID_BASE - moverIndex;
  evt.normal  = normal;
  evt.point   = contactPoint;
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveCapsuleVsMover(BodyView& body, int moverIndex) {
  KinematicMover& mover = movers_[static_cast<std::size_t>(moverIndex)];
  if (!groupsInteract(body.getMembership(), body.getFilter(), mover.membership, mover.filter)) return;

  const Quat invRot = mover.currentRot.conjugate();
  const Vec3 axisHalf = body.getRotation().rotate(Vec3{0.f, body.getCapsuleHalfHeight(), 0.f});
  const Vec3 segA = invRot.rotate((body.getPosition() - axisHalf) - mover.currentPos);
  const Vec3 segB = invRot.rotate((body.getPosition() + axisHalf) - mover.currentPos);

  // Alternating projection between the segment and the box converges to the
  // closest pair within a handful of iterations for a convex box.
  Vec3 boxPt = Vec3::zero();
  for (int iter = 0; iter < 6; ++iter) {
    const Vec3 segPt = closestPointOnSegment(boxPt, segA, segB);
    boxPt = clampToHalfExtents(segPt, mover.halfExtents);
  }
  const Vec3 segPtLocal = closestPointOnSegment(boxPt, segA, segB);

  const Vec3 delta = segPtLocal - boxPt;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (distSq >= radius * radius) return;

  Vec3 localNormal;
  float penetration;
  if (distSq < MOVER_EPSILON_SQ) {
    float shallow;
    deepestFaceNormal(segPtLocal, mover.halfExtents, localNormal, shallow);
    penetration = radius + shallow;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    penetration = radius - dist;
  }

  const Vec3 normal = mover.currentRot.rotate(localNormal).normalized();
  const Vec3 worldSegPt = mover.currentRot.rotate(segPtLocal) + mover.currentPos;
  const Vec3 contactPoint = worldSegPt - normal * radius;
  const Vec3 moverArm = contactPoint - mover.currentPos;
  const Vec3 moverPointVel = mover.linearVelocity + mover.angularVelocity.cross(moverArm);

  const float e = std::min(body.getRestitution(), mover.restitution);
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(mover.friction, 0.f));
  const float j = applyMoverContactImpulse(body, contactPoint, normal, moverPointVel, e, mu, penetration);

  constexpr float SLOP = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = KINEMATIC_MOVER_ID_BASE - moverIndex;
  evt.normal  = normal;
  evt.point   = contactPoint;
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
