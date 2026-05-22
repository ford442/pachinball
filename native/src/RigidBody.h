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

/** Descriptor passed to PhysicsWorld::createRigidBody(). */
struct RigidBodyDesc {
  Vec3      position       = Vec3::zero();
  Vec3      velocity       = Vec3::zero();
  float     mass           = 1.f;    ///< kg (ignored for Static/Kinematic)
  float     radius         = 0.1f;   ///< Bounding sphere radius (metres)
  float     restitution    = 0.4f;   ///< Coefficient of restitution (0–1)
  float     linearDamping  = 0.02f;  ///< Linear drag factor
  BodyType  type           = BodyType::Dynamic;
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
  float    getRadius()  const { return desc_.radius; }
  float    getMass()    const { return desc_.mass; }
  float    getInvMass() const {
    return (desc_.type == BodyType::Dynamic && desc_.mass > 0.f)
           ? 1.f / desc_.mass : 0.f;
  }
  float getRestitution()   const { return desc_.restitution; }
  float getLinearDamping() const { return desc_.linearDamping; }

  // ---- Position / velocity --------------------------------------------
  const Vec3& getPosition() const { return position_; }
  const Vec3& getVelocity() const { return velocity_; }
  const Quat& getRotation() const { return rotation_; }

  void setPosition(const Vec3& p)    { position_ = p; }
  void setVelocity(const Vec3& v)    { velocity_ = v; }
  void setRotation(const Quat& q)    { rotation_ = q; }

  // ---- Force / impulse accumulation -----------------------------------
  void applyForce(const Vec3& f)     { forceAccum_ += f; }
  void applyImpulse(const Vec3& imp) { velocity_   += imp * getInvMass(); }
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
  Quat           rotation_   = Quat::identity();
  Vec3           forceAccum_ = Vec3::zero();
};

} // namespace pachinball
