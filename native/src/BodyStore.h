#pragma once

#include "MathTypes.h"
#include "BodyDesc.h"
#include "HandleTable.h"

#include <cstdint>
#include <vector>

namespace pachinball {

class BodyStore;

/** Non-owning view over one dense slot in BodyStore. */
class BodyView {
public:
  BodyView() = default;
  BodyView(BodyStore* store, int denseIndex, int publicId);

  [[nodiscard]] int  getId()       const { return publicId_; }
  [[nodiscard]] bool isActive()    const;
  void setActive(bool v);

  [[nodiscard]] BodyType getType()    const;
  [[nodiscard]] Shape    getShape()   const;
  [[nodiscard]] float    getRadius()  const;
  [[nodiscard]] float    getCapsuleHalfHeight() const;
  [[nodiscard]] Vec3     getBoxHalfExtents() const;
  [[nodiscard]] float    getMass()    const;
  [[nodiscard]] float    getInvMass() const;
  [[nodiscard]] float    getInvInertia() const;
  [[nodiscard]] float    getRestitution()   const;
  [[nodiscard]] float    getLinearDamping() const;
  [[nodiscard]] float    getFriction()      const;
  [[nodiscard]] float    getAngularDamping() const;

  [[nodiscard]] Vec3 getPosition()        const;
  [[nodiscard]] Vec3 getVelocity()        const;
  [[nodiscard]] Vec3 getAngularVelocity() const;
  [[nodiscard]] Quat getRotation()        const;

  void setPosition(const Vec3& p);
  void setVelocity(const Vec3& v);
  void setAngularVelocity(const Vec3& w);
  void setRotation(const Quat& q);

  void applyForce(const Vec3& f);
  void applyImpulse(const Vec3& imp);
  void applyTorqueImpulse(const Vec3& torqueImp);
  void applyImpulseAt(const Vec3& impulse, const Vec3& worldPoint);
  void clearForces();

  [[nodiscard]] uint32_t getMembership() const;
  [[nodiscard]] uint32_t getFilter()     const;
  void setCollisionGroups(uint32_t membership, uint32_t filter);

  void integrate(float dt, const Vec3& gravity);
  void wake();

  [[nodiscard]] int denseIndex() const { return denseIndex_; }
  [[nodiscard]] bool valid() const { return store_ != nullptr && denseIndex_ >= 0; }

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
  /** Snapshot.cpp dumps / reloads every SoA column verbatim. */
  friend struct SnapshotAccess;

  int create(HandleTable& handles, const RigidBodyDesc& desc);
  bool remove(HandleTable& handles, int publicId);

  [[nodiscard]] int denseCount() const { return static_cast<int>(denseToPublicId_.size()); }
  [[nodiscard]] int publicIdAt(int denseIndex) const { return denseToPublicId_[static_cast<std::size_t>(denseIndex)]; }

  BodyView view(int denseIndex);
  BodyView viewById(HandleTable& handles, int publicId);

  /**
   * Retype a live slot: rebuilds inverse mass / inertia from its stored mass
   * and shape, clears accumulated force and wakes it. Pose and velocity are
   * left to the caller (PhysicsWorld::setBodyType).
   */
  void setType(int denseIndex, BodyType type);

  void integrateAll(float dt, const Vec3& gravity);
  void updateSleep(float linearThreshold, float angularThreshold, int framesRequired);

  [[nodiscard]] int activeCount() const;

  // Broadphase / tests — raw SoA access
  [[nodiscard]] float posX(int i) const { return posX_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] float posY(int i) const { return posY_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] float posZ(int i) const { return posZ_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] float velX(int i) const { return velX_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] float velY(int i) const { return velY_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] float velZ(int i) const { return velZ_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] float radius(int i) const { return radius_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] float capsuleHalfHeight(int i) const { return capsuleHalfHeight_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] Vec3 boxHalfExtents(int i) const {
    const std::size_t j = static_cast<std::size_t>(i);
    return {boxHalfX_[j], boxHalfY_[j], boxHalfZ_[j]};
  }
  [[nodiscard]] uint8_t type(int i) const { return type_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] uint8_t shape(int i) const { return shape_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] bool isActive(int i) const { return active_[static_cast<std::size_t>(i)] != 0; }
  [[nodiscard]] bool isAwake(int i) const { return isActive(i); }
  [[nodiscard]] uint32_t membership(int i) const { return membership_[static_cast<std::size_t>(i)]; }
  [[nodiscard]] uint32_t filter(int i) const { return filter_[static_cast<std::size_t>(i)]; }

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
  std::vector<float>   boxHalfX_, boxHalfY_, boxHalfZ_;
  std::vector<float>   restitution_;
  std::vector<float>   friction_;
  std::vector<float>   linearDamping_;
  std::vector<float>   angularDamping_;
  std::vector<float>   mass_;

  std::vector<uint8_t> type_;
  std::vector<uint8_t> shape_;
  std::vector<uint8_t> active_;
  std::vector<uint16_t> sleepCounter_;
  std::vector<uint32_t> membership_;
  std::vector<uint32_t> filter_;
};

} // namespace pachinball
