#include "HingeJoint.h"
#include "BodyStore.h"

#include <cmath>
#include <algorithm>

namespace pachinball {

namespace {

constexpr float kPi = 3.14159265f;
constexpr float kEps = 1e-12f;

float wrapPi(float a) {
  while (a >  kPi) a -= 2.f * kPi;
  while (a < -kPi) a += 2.f * kPi;
  return a;
}

void refreshPointVel(const BodyView& body, const Vec3& r, Vec3& v, Vec3& w, Vec3& vpt) {
  v = body.getVelocity();
  w = body.getAngularVelocity();
  vpt = v + w.cross(r);
}

} // namespace

float computeHingeAngle(const HingeJoint& joint, const Quat& rotation) {
  const Quat qRel = rotation * joint.restRotation.conjugate();
  const Vec3 qv{qRel.x, qRel.y, qRel.z};
  const float sinHalf = qv.dot(joint.worldAxis);
  return wrapPi(2.f * std::atan2(sinHalf, qRel.w));
}

void solveWorldHinge(HingeJoint& joint, BodyView& body, float dt) {
  if (!body.valid() || !joint.active) return;

  const float invM = body.getInvMass();
  const float invI = body.getInvInertia();
  if (invM <= kEps && invI <= kEps) return;

  const Vec3 n = joint.worldAxis;
  const float invDt = 1.f / std::max(dt, 1e-8f);
  const float beta = joint.baumgarte;

  auto solveLinearAxis = [&](const Vec3& axis) {
    const Quat q = body.getRotation();
    const Vec3 r = q.rotate(joint.localAnchor);
    const Vec3 C = body.getPosition() + r - joint.worldAnchor;
    Vec3 v, w, vpt;
    refreshPointVel(body, r, v, w, vpt);

    const float c = C.dot(axis);
    const float jv = vpt.dot(axis);
    const float rxaSq = r.cross(axis).lengthSq();
    const float keff = invM + invI * rxaSq;
    if (keff < kEps) return;

    const float lambda = -(jv + beta * c * invDt) / keff;
    if (std::fabs(lambda) < 1e-8f) return;
    const Vec3 impulse = axis * lambda;
    body.applyImpulse(impulse);
    body.applyTorqueImpulse(r.cross(impulse));
  };

  solveLinearAxis({1.f, 0.f, 0.f});
  solveLinearAxis({0.f, 1.f, 0.f});
  solveLinearAxis({0.f, 0.f, 1.f});

  if (invI > kEps) {
    Vec3 w = body.getAngularVelocity();
    const Vec3 wSwing = w - n * w.dot(n);
    if (wSwing.lengthSq() > 1e-12f) {
      body.applyTorqueImpulse(wSwing * (-1.f / invI));
    }

    const Quat q = body.getRotation();
    const Quat qRel = q * joint.restRotation.conjugate();
    const Vec3 rv{qRel.x, qRel.y, qRel.z};
    const Vec3 swingErr = rv - n * rv.dot(n);
    if (swingErr.lengthSq() > 1e-12f) {
      body.applyTorqueImpulse(swingErr * (-2.f * beta * invDt / invI));
    }

    w = body.getAngularVelocity();
    const float wAxis = w.dot(n);

    if (joint.motorMaxTorque > 0.f) {
      float lambda = (joint.motorTargetVel - wAxis) / invI;
      const float maxL = joint.motorMaxTorque * dt;
      lambda = std::max(-maxL, std::min(maxL, lambda));
      if (std::fabs(lambda) > kEps) {
        body.applyTorqueImpulse(n * lambda);
      }
    }

    const float angle = computeHingeAngle(joint, body.getRotation());
    const float wAxis2 = body.getAngularVelocity().dot(n);

    if (angle < joint.minAngle) {
      const float C = angle - joint.minAngle;
      float lambda = -(wAxis2 + beta * C * invDt) / invI;
      if (lambda < 0.f) lambda = 0.f;
      if (lambda > 0.f) body.applyTorqueImpulse(n * lambda);
    } else if (angle > joint.maxAngle) {
      const float C = angle - joint.maxAngle;
      float lambda = -(wAxis2 + beta * C * invDt) / invI;
      if (lambda > 0.f) lambda = 0.f;
      if (lambda < 0.f) body.applyTorqueImpulse(n * lambda);
    }
  }
}

} // namespace pachinball
