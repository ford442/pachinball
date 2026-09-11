/**
 * Narrowphase geometric contact tests + the sequential-impulse contact
 * solver, split out of PhysicsWorld.cpp (dispatch-only) per the #383 house
 * line-count limit. All functions here are PhysicsWorld methods — declared
 * in PhysicsWorld.h, defined here.
 */
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

static constexpr float CONTACT_EPSILON_SQ = 1e-10f;

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
  if (!groupsInteract(a.getMembership(), a.getFilter(), b.getMembership(), b.getFilter())) return;

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
  if (!groupsInteract(body.getMembership(), body.getFilter(), box.membership, box.filter)) return;

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
  if (!groupsInteract(body.getMembership(), body.getFilter(), cap.membership, cap.filter)) return;

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
  if (!groupsInteract(sphere.getMembership(), sphere.getFilter(),
                      capsule.getMembership(), capsule.getFilter())) return;

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
