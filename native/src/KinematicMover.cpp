#include "KinematicMover.h"
#include "CollisionFilter.h"
#include "VolumeShape.h"
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

  poseDeltaVelocity(mover.currentPos, mover.currentRot, mover.nextPos, mover.nextRot, dt,
                    mover.linearVelocity, mover.angularVelocity);

  mover.currentPos = mover.nextPos;
  mover.currentRot = mover.nextRot;
  mover.hasNextPose = false;
}

void poseDeltaVelocity(const Vec3& fromPos, const Quat& fromRot,
                       const Vec3& toPos, const Quat& toRot, float dt,
                       Vec3& outLinear, Vec3& outAngular) {
  outLinear = (toPos - fromPos) / dt;

  // Shortest-path quaternion delta: dq = to * from^-1, then small-angle
  // extraction ω ≈ 2 * dq.xyz / dt.
  Quat dq = toRot * fromRot.conjugate();
  if (dq.w < 0.f) dq = Quat{-dq.x, -dq.y, -dq.z, -dq.w};
  outAngular = Vec3{dq.x, dq.y, dq.z} * (2.f / dt);
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

void PhysicsWorld::resolveSphereVsMover(BodyView& body, int moverIndex) {
  KinematicMover& mover = movers_[static_cast<std::size_t>(moverIndex)];
  if (!groupsInteract(body.getMembership(), body.getFilter(), mover.membership, mover.filter)) return;

  const Quat invRot = mover.currentRot.conjugate();
  const Vec3 localCenter = invRot.rotate(body.getPosition() - mover.currentPos);
  bool inside = false;
  const Vec3 closest = closestPointOnVolume(mover.shape, localCenter, mover.halfExtents, inside);

  const Vec3 delta = localCenter - closest;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (!inside && distSq >= radius * radius) return;

  Vec3 localNormal;
  float penetration;
  if (inside || distSq < MOVER_EPSILON_SQ) {
    float shallow;
    deepestVolumeNormal(mover.shape, localCenter, mover.halfExtents, localNormal, shallow);
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

  // Alternating projection between the segment and the volume converges to
  // the closest pair within a handful of iterations for any convex volume.
  Vec3 volumePt = Vec3::zero();
  bool inside = false;
  for (int iter = 0; iter < 6; ++iter) {
    const Vec3 segPt = closestPointOnSegment(volumePt, segA, segB);
    volumePt = closestPointOnVolume(mover.shape, segPt, mover.halfExtents, inside);
  }
  const Vec3 segPtLocal = closestPointOnSegment(volumePt, segA, segB);
  closestPointOnVolume(mover.shape, segPtLocal, mover.halfExtents, inside);

  const Vec3 delta = segPtLocal - volumePt;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (!inside && distSq >= radius * radius) return;

  Vec3 localNormal;
  float penetration;
  if (inside || distSq < MOVER_EPSILON_SQ) {
    float shallow;
    deepestVolumeNormal(mover.shape, segPtLocal, mover.halfExtents, localNormal, shallow);
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
