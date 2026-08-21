#pragma once

#include "MathTypes.h"
#include "RigidBody.h"
#include "HandleTable.h"

#include <cstdint>
#include <vector>

namespace pachinball {

class BodyStore;

/** Non-owning view over one dense slot in BodyStore — same API surface as RigidBody. */
class BodyView {
public:
  BodyView() = default;
  BodyView(BodyStore* store, int denseIndex, int publicId);

  int  getId()       const { return publicId_; }
  bool isActive()    const;
  void setActive(bool v);

  BodyType getType()    const;
  Shape    getShape()   const;
  float    getRadius()  const;
  float    getCapsuleHalfHeight() const;
  float    getMass()    const;
  float    getInvMass() const;
  float    getInvInertia() const;
  float    getRestitution()   const;
  float    getLinearDamping() const;
  float    getFriction()      const;
  float    getAngularDamping() const;

  Vec3 getPosition()        const;
  Vec3 getVelocity()        const;
  Vec3 getAngularVelocity() const;
  Quat getRotation()        const;

  void setPosition(const Vec3& p);
  void setVelocity(const Vec3& v);
  void setAngularVelocity(const Vec3& w);
  void setRotation(const Quat& q);

  void applyForce(const Vec3& f);
  void applyImpulse(const Vec3& imp);
  void applyTorqueImpulse(const Vec3& torqueImp);
  void applyImpulseAt(const Vec3& impulse, const Vec3& worldPoint);
  void clearForces();

  void integrate(float dt, const Vec3& gravity);
  void wake();

  int denseIndex() const { return denseIndex_; }
  bool valid() const { return store_ != nullptr && denseIndex_ >= 0; }

private:
  BodyStore* store_      = nullptr;
  int        denseIndex_ = -1;
  int        publicId_   = -1;
};

/**
 * Structure-of-arrays rigid-body storage with dense iteration and
 * swap-and-pop removal.
 */
class BodyStore {
public:
  friend class BodyView;

  int create(HandleTable& handles, const RigidBodyDesc& desc);
  bool remove(HandleTable& handles, int publicId);

  int denseCount() const { return static_cast<int>(denseToPublicId_.size()); }
  int publicIdAt(int denseIndex) const { return denseToPublicId_[static_cast<std::size_t>(denseIndex)]; }

  BodyView view(int denseIndex);
  BodyView viewById(HandleTable& handles, int publicId);

  void integrateAll(float dt, const Vec3& gravity);
  void updateSleep(float linearThreshold, float angularThreshold, int framesRequired);

  int activeCount() const;

  // Broadphase / tests — raw SoA access
  float posX(int i) const { return posX_[static_cast<std::size_t>(i)]; }
  float posY(int i) const { return posY_[static_cast<std::size_t>(i)]; }
  float posZ(int i) const { return posZ_[static_cast<std::size_t>(i)]; }
  float velX(int i) const { return velX_[static_cast<std::size_t>(i)]; }
  float velY(int i) const { return velY_[static_cast<std::size_t>(i)]; }
  float velZ(int i) const { return velZ_[static_cast<std::size_t>(i)]; }
  float radius(int i) const { return radius_[static_cast<std::size_t>(i)]; }
  float capsuleHalfHeight(int i) const { return capsuleHalfHeight_[static_cast<std::size_t>(i)]; }
  uint8_t type(int i) const { return type_[static_cast<std::size_t>(i)]; }
  uint8_t shape(int i) const { return shape_[static_cast<std::size_t>(i)]; }
  bool isActive(int i) const { return active_[static_cast<std::size_t>(i)] != 0; }
  bool isAwake(int i) const { return isActive(i); }

  void scatterTransformSlot(int publicId, float* dst, int stride) const;

private:
  void appendSlot(int publicId, const RigidBodyDesc& desc);
  void swapPop(int denseIndex);
  static float computeInvInertia(const RigidBodyDesc& desc);

  std::vector<int>     denseToPublicId_;

  std::vector<float>   posX_, posY_, posZ_;
  std::vector<float>   velX_, velY_, velZ_;
  std::vector<float>   angVelX_, angVelY_, angVelZ_;
  std::vector<float>   rotX_, rotY_, rotZ_, rotW_;
  std::vector<float>   forceX_, forceY_, forceZ_;

  std::vector<float>   invMass_;
  std::vector<float>   invInertia_;
  std::vector<float>   radius_;
  std::vector<float>   capsuleHalfHeight_;
  std::vector<float>   restitution_;
  std::vector<float>   friction_;
  std::vector<float>   linearDamping_;
  std::vector<float>   angularDamping_;
  std::vector<float>   mass_;

  std::vector<uint8_t> type_;
  std::vector<uint8_t> shape_;
  std::vector<uint8_t> active_;
  std::vector<uint16_t> sleepCounter_;
};

} // namespace pachinball
