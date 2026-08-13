#include "RigidBody.h"

namespace pachinball {

RigidBody::RigidBody(int id, const RigidBodyDesc& desc)
    : id_(id), desc_(desc),
      position_(desc.position),
      velocity_(desc.velocity) {}

void RigidBody::integrate(float dt, const Vec3& gravity) {
  if (desc_.type != BodyType::Dynamic || !active_) return;

  // Accumulate gravity as a force (F = m * g)
  Vec3 totalForce = forceAccum_ + gravity * desc_.mass;

  // Semi-implicit Euler integration
  Vec3 acceleration = totalForce * getInvMass();
  velocity_ += acceleration * dt;

  // Linear damping: v *= (1 - damping * dt), clamped to zero
  float dampFactor = 1.f - desc_.linearDamping * dt;
  if (dampFactor < 0.f) dampFactor = 0.f;
  velocity_ *= dampFactor;

  float angDampFactor = 1.f - desc_.angularDamping * dt;
  if (angDampFactor < 0.f) angDampFactor = 0.f;
  angularVelocity_ *= angDampFactor;

  position_ += velocity_ * dt;

  // Quaternion derivative q' = 0.5 * ω_quat * q
  const Quat omegaQuat{angularVelocity_.x, angularVelocity_.y, angularVelocity_.z, 0.f};
  rotation_ = (rotation_ + (omegaQuat * rotation_) * (0.5f * dt)).normalized();

  // Clear force accumulator for next frame
  forceAccum_ = Vec3::zero();
}

} // namespace pachinball
