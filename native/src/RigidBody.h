#pragma once

#include "MathTypes.h"
#include <cstdint>

namespace pachinball {

/** Identifies how a body participates in simulation. */
enum class BodyType : uint8_t {
  Dynamic  = 0, ///< Moves under forces; owns mass / inertia.
  Static   = 1, ///< Immovable; contributes to collision but never moves.
  Kinematic = 2 ///< Moved programmatically; does not respond to forces.
};

/** Identifies the collision shape a RigidBody presents. */
enum class Shape : uint8_t {
  Sphere  = 0, ///< Bounding sphere of `radius` (the original/default shape).
  Capsule = 1  ///< Capsule of `radius` and `capsuleHalfHeight`, segment along local +Y.
};

/** Descriptor passed to PhysicsWorld::createRigidBody(). */
struct RigidBodyDesc {
  Vec3      position       = Vec3::zero();
  Vec3      velocity       = Vec3::zero();
  float     mass           = 1.f;    ///< kg (ignored for Static/Kinematic)
  float     radius         = 0.1f;   ///< Bounding sphere radius, or capsule radius (metres)
  float     restitution    = 0.4f;   ///< Coefficient of restitution (0–1)
  float     linearDamping  = 0.02f;  ///< Linear drag factor
  BodyType  type           = BodyType::Dynamic;
  Shape     shape          = Shape::Sphere;
  float     capsuleHalfHeight = 0.5f; ///< Half-length of the capsule segment (ignored for Sphere)
  float     friction          = 0.2f; ///< Coulomb friction coefficient (≥ 0)
  float     angularDamping    = 0.1f; ///< Angular drag factor (dynamic spheres)
};

/** Live rigid-body state, managed by PhysicsWorld. */
class RigidBody {
public:
  explicit RigidBody(int id, const RigidBodyDesc& desc);

  // ---- Identity -------------------------------------------------------
  int  getId()       const { return id_; }
  bool isActive()    const { return active_; }
  void setActive(bool v)   { active_ = v; }

  // ---- Geometric properties -------------------------------------------
  BodyType getType()    const { return desc_.type; }
  Shape    getShape()   const { return desc_.shape; }
  float    getRadius()  const { return desc_.radius; }
  float    getCapsuleHalfHeight() const { return desc_.capsuleHalfHeight; }
  float    getMass()    const { return desc_.mass; }
  float    getInvMass() const {
    return (desc_.type == BodyType::Dynamic && desc_.mass > 0.f)
           ? 1.f / desc_.mass : 0.f;
  }
  float getRestitution()     const { return desc_.restitution; }
  float getLinearDamping()   const { return desc_.linearDamping; }
  float getFriction()        const { return desc_.friction; }
  float getAngularDamping()  const { return desc_.angularDamping; }

  /**
   * Inverse scalar (isotropic) inertia.
   * Dynamic spheres: I = 2/5 m r².
   * Dynamic capsules: averaged cylinder inertia so hinges can motor the blade.
   * Static / kinematic bodies report 0.
   */
  float getInvInertia() const {
    if (desc_.type != BodyType::Dynamic || desc_.mass <= 0.f) return 0.f;
    if (desc_.shape == Shape::Sphere) {
      const float r2 = desc_.radius * desc_.radius;
      if (r2 < 1e-12f) return 0.f;
      return 2.5f / (desc_.mass * r2);
    }
    if (desc_.shape == Shape::Capsule) {
      const float r = desc_.radius;
      const float h = 2.f * desc_.capsuleHalfHeight;
      const float Iax = 0.5f * desc_.mass * r * r;
      const float Ipp = (1.f / 12.f) * desc_.mass * (3.f * r * r + h * h);
      const float I = (Iax + 2.f * Ipp) / 3.f;
      return I > 1e-12f ? 1.f / I : 0.f;
    }
    return 0.f;
  }

  // ---- Position / velocity --------------------------------------------
  const Vec3& getPosition()        const { return position_; }
  const Vec3& getVelocity()        const { return velocity_; }
  const Vec3& getAngularVelocity() const { return angularVelocity_; }
  const Quat& getRotation()        const { return rotation_; }

  void setPosition(const Vec3& p)        { position_ = p; }
  void setVelocity(const Vec3& v)        { velocity_ = v; }
  void setAngularVelocity(const Vec3& w) { angularVelocity_ = w; }
  void setRotation(const Quat& q)        { rotation_ = q; }

  // ---- Force / impulse accumulation -----------------------------------
  void applyForce(const Vec3& f)     { forceAccum_ += f; }
  void applyImpulse(const Vec3& imp) { velocity_   += imp * getInvMass(); }
  void applyTorqueImpulse(const Vec3& torqueImp) {
    angularVelocity_ += torqueImp * getInvInertia();
  }
  /** Impulse at a world-space point: linear Δv plus τ = r × J. */
  void applyImpulseAt(const Vec3& impulse, const Vec3& worldPoint) {
    applyImpulse(impulse);
    applyTorqueImpulse((worldPoint - position_).cross(impulse));
  }
  void clearForces()                 { forceAccum_  = Vec3::zero(); }
  const Vec3& getAccumulatedForce() const { return forceAccum_; }

  // ---- Integration (called by PhysicsWorld) ---------------------------
  void integrate(float dt, const Vec3& gravity);

private:
  int            id_;
  bool           active_     = true;
  RigidBodyDesc  desc_;
  Vec3           position_;
  Vec3           velocity_;
  Vec3           angularVelocity_ = Vec3::zero();
  Quat           rotation_   = Quat::identity();
  Vec3           forceAccum_ = Vec3::zero();
};

} // namespace pachinball
