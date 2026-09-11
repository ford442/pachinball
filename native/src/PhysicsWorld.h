#pragma once

#include "MathTypes.h"
#include "RigidBody.h"
#include "ContactListener.h"
#include "BodyStore.h"
#include "CollisionFilter.h"
#include "HandleTable.h"
#include "BroadphaseGrid.h"
#include "HingeJoint.h"
#include "KinematicMover.h"
#include "SensorVolume.h"
#include "StaticShapes.h"

#include <vector>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace pachinball {

/** Parameters for creating an infinite half-space (static plane). */
struct PlaneDesc {
  Vec3  normal   = Vec3::up();
  float distance = 0.f;
  float friction = 0.2f;
};

/** Oriented static box collider (half-extents in local space). */
struct BoxDesc {
  Vec3     center       = Vec3::zero();
  Vec3     halfExtents  = {0.5f, 0.5f, 0.5f};
  Quat     rotation     = Quat::identity();
  float    restitution  = 0.4f;
  float    friction     = 0.2f;
  uint32_t membership   = COLLISION_GROUPS_ALL;
  uint32_t filter       = COLLISION_GROUPS_ALL;
};

/** Oriented static capsule collider (local Y is the segment axis). */
struct CapsuleDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.1f;
  float    halfHeight  = 0.5f;
  Quat     rotation    = Quat::identity();
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/** Negative body IDs reserved for static colliders in contact events. */
static constexpr int STATIC_PLANE_ID    = -1;
static constexpr int STATIC_BOX_ID_BASE   = -1000;
static constexpr int STATIC_CAPSULE_ID_BASE = -2000;
// KINEMATIC_MOVER_ID_BASE (-3000) and SENSOR_VOLUME_ID_BASE (-4000) are
// declared in KinematicMover.h / SensorVolume.h respectively;
// STATIC_CYLINDER_ID_BASE (-5000) and STATIC_SPHERE_ID_BASE (-6000) in
// StaticShapes.h.

/**
 * Entries per static-handle family.
 *
 * The id bases above are spaced 1000 apart, so the 1001st shape of a family
 * would be handed the next family's base — `setCollisionGroups` would then
 * edit the wrong descriptor and a contact id would name two different
 * shapes. Creation is refused at the cap instead: a dropped collider is
 * visible (`getDroppedStaticCount()`) where aliasing is silent.
 */
inline constexpr std::size_t STATIC_HANDLE_CAPACITY = 1000;

/**
 * Returned by an add*() that hit `STATIC_HANDLE_CAPACITY`. Positive, so it can
 * never be mistaken for a static handle, and no body ever carries this id — so
 * passing it to setCollisionGroups() is a no-op rather than a mis-edit.
 */
inline constexpr int STATIC_HANDLE_OVERFLOW = 0x7FFFFFFF;

/** Packed transform-buffer layout (16 floats per public-id slot). */
inline constexpr int TRANSFORM_STRIDE = 16;

/** Per-world simulation parameters. */
struct WorldParams {
  Vec3  gravity          = {0.f, -9.81f, -5.0f};
  float fixedTimestep    = 1.f / 60.f;
  float maxSubsteps      = 8;
  int   solverIterations = 4;
  float rollingResistance = 0.04f;
  float sleepLinearThreshold  = 0.05f;
  float sleepAngularThreshold = 0.1f;
  int   sleepFramesRequired   = 60;
};

class PhysicsWorld {
public:
  explicit PhysicsWorld(const WorldParams& params = WorldParams{});
  ~PhysicsWorld();

  PhysicsWorld(const PhysicsWorld&) = delete;
  PhysicsWorld& operator=(const PhysicsWorld&) = delete;

  int  createRigidBody(const RigidBodyDesc& desc);
  void removeRigidBody(int id);

  void applyForce(int id, float fx, float fy, float fz);
  void applyImpulse(int id, float ix, float iy, float iz);
  void setVelocity(int id, float vx, float vy, float vz);
  void setAngularVelocity(int id, float wx, float wy, float wz);
  void setBodyPosition(int id, float px, float py, float pz);
  void setBodyRotation(int id, float qx, float qy, float qz, float qw);

  void addStaticPlane(float nx, float ny, float nz, float distance, float friction = 0.2f);

  int addStaticBox(float px, float py, float pz,
                   float hx, float hy, float hz,
                   float qx, float qy, float qz, float qw,
                   float restitution = 0.4f,
                   float friction = 0.2f);

  int addStaticCapsule(float px, float py, float pz,
                       float radius, float halfHeight,
                       float qx, float qy, float qz, float qw,
                       float restitution = 0.4f,
                       float friction = 0.2f);

  /**
   * Add an oriented static cylinder (local Y axis), matching Rapier's
   * `ColliderDesc.cylinder(halfHeight, radius)`.
   * @returns negative handle.
   */
  int addStaticCylinder(float px, float py, float pz,
                        float radius, float halfHeight,
                        float qx, float qy, float qz, float qw,
                        float restitution = 0.4f,
                        float friction = 0.2f);

  /** Add a static sphere collider. @returns negative handle. */
  int addStaticSphere(float px, float py, float pz,
                      float radius,
                      float restitution = 0.4f,
                      float friction = 0.2f);

  /** Add a kinematic oriented-box mover (piston, platter, gate). @returns negative handle. */
  int addKinematicMover(const KinematicMoverDesc& desc);

  /** Push the pose this mover should reach by the next `step()`; velocity is derived from the delta. */
  void setNextKinematicTransform(int moverId, float px, float py, float pz,
                                 float qx, float qy, float qz, float qw);

  /** Add a static OBB trigger volume (Enter/Stay/Exit events, zero impulse). @returns negative handle. */
  int addSensorVolume(const SensorVolumeDesc& desc);

  /**
   * Drop every static collider, sensor volume and kinematic mover.
   *
   * Statics are append-only (they live in flat vectors indexed by their
   * negative handle), so a scene that is rebuilt — a new adventure track, or
   * a fresh WasmOwner.rebuild() — must clear before re-adding or it stacks a
   * second copy of the old geometry. INVALIDATES every negative handle;
   * dynamic bodies, hinges and their ids are untouched.
   */
  void clearStaticGeometry();

  /**
   * Set the collision-group membership/filter mask for any handle — a
   * dynamic/kinematic body (id ≥ 0) or a static
   * box/capsule/cylinder/sphere/mover/sensor (id < 0, as returned by the
   * matching add*() call).
   */
  void setCollisionGroups(int id, uint32_t membership, uint32_t filter);

  void getPosition(int id, float* px, float* py, float* pz) const;
  void getVelocity(int id, float* vx, float* vy, float* vz) const;
  void getAngularVelocity(int id, float* wx, float* wy, float* wz) const;
  void getRotation(int id, float* qx, float* qy, float* qz, float* qw) const;

  float step(float rawDt);

  int   createHinge(int bodyId, const HingeDesc& desc);
  void  setHingeMotor(int id, float targetVel, float maxTorque);
  float getHingeAngle(int id) const;
  void  removeHinge(int id);

  /** Static shapes refused because their family hit STATIC_HANDLE_CAPACITY. */
  int getDroppedStaticCount() const { return droppedStatics_; }

  uint64_t getStepCount() const { return stepCount_; }
  int getActiveBodyCount() const;

  void setContactCallback(ContactCallback cb) {
    contactListener_.setCallback(std::move(cb));
  }

  const float* getContactBufferPtr() const { return contactListener_.getContactBufferPtr(); }
  float* getContactBufferPtr() { return contactListener_.getContactBufferPtr(); }
  int getContactCount() const { return contactListener_.getContactCount(); }
  int getDroppedContactCount() const { return contactListener_.getDroppedContactCount(); }
  void setMaxContacts(int max) {
    contactListener_.setMaxContacts(max > 0 ? static_cast<std::size_t>(max) : 1);
  }
  int getMaxContacts() const { return static_cast<int>(contactListener_.getMaxContacts()); }
  const std::vector<ContactEvent>& lastContactEvents() const {
    return contactListener_.lastEvents();
  }

  const float* getTransformBufferPtr() const { return transformBuffer_; }
  float* getTransformBufferPtr() { return transformBuffer_; }
  int getTransformStride() const { return TRANSFORM_STRIDE; }
  int getTransformSlotCount() const { return handles_.nextId(); }

  /** Test hook — pairs emitted by broadphase in the last substep. */
  int getLastBroadphasePairCount() const { return broadphase_.lastPairCount(); }

  void setGravity(float gx, float gy, float gz) { params_.gravity = {gx, gy, gz}; }
  void setRollingResistance(float rr) { params_.rollingResistance = rr; }
  float getRollingResistance() const { return params_.rollingResistance; }

private:
  BodyView findView(int id) const;
  BodyView findViewMut(int id);

  void substep(float dt);
  void solveHinges(float dt);
  void scatterTransforms();

  void ensureTransformCapacity(int slotCount);
  void freeTransformBuffer();

  float applyContactImpulse(BodyView& a, BodyView* b,
                            const Vec3& contactPoint, const Vec3& normal,
                            float restitution, float friction,
                            float penetration = 0.f);

  void resolveSphereVsSphere(BodyView& a, BodyView& b);
  void resolveSphereVsPlane(BodyView& body, const PlaneDesc& plane);
  void resolveSphereVsBox(BodyView& body, const BoxDesc& box, int boxId);
  void resolveSphereVsCapsule(BodyView& body, const CapsuleDesc& cap, int capId);
  void resolveSphereVsCapsuleBody(BodyView& sphere, BodyView& capsule);

  // ---- Static cylinder / sphere (StaticShapes.cpp) ---------------------
  void resolveSphereVsCylinder(BodyView& body, const CylinderDesc& cyl, int cylId);
  void resolveSphereVsStaticSphere(BodyView& body, const SphereDesc& sph, int sphId);

  void wakeOnContact(BodyView& a, BodyView* b);

  static Vec3 closestPointOnSegment(const Vec3& p, const Vec3& segA, const Vec3& segB);

  // ---- Kinematic movers (KinematicMover.cpp) ---------------------------
  void resolveSphereVsMover(BodyView& body, int moverIndex);
  void resolveCapsuleVsMover(BodyView& body, int moverIndex);
  /** One-sided impulse: `body` reacts to a contact against a prescribed-velocity, infinite-mass opponent. */
  float applyMoverContactImpulse(BodyView& body, const Vec3& contactPoint, const Vec3& normal,
                                 const Vec3& otherPointVel, float restitution, float friction,
                                 float penetration);

  // ---- Sensor volumes (SensorVolume.cpp) --------------------------------
  void resolveSphereVsSensor(BodyView& body, int sensorIndex);

  WorldParams                    params_;
  BodyStore                      bodies_;
  HandleTable                    handles_;
  BroadphaseGrid                 broadphase_;
  std::vector<BroadphaseGrid::Pair> pairs_;

  std::vector<PlaneDesc>         planes_;
  std::vector<BoxDesc>           boxes_;
  std::vector<CapsuleDesc>       capsules_;
  std::vector<CylinderDesc>      cylinders_;
  std::vector<SphereDesc>        spheres_;
  std::vector<KinematicMover>    movers_;
  std::vector<SensorVolumeDesc>  sensors_;
  std::vector<HingeJoint>        hinges_;
  int                            nextHingeId_ = 0;
  ContactListener                contactListener_;

  float*                         transformBuffer_ = nullptr;
  std::size_t                    transformCapSlots_ = 0;

  int                            droppedStatics_ = 0;

  float                          accumulator_  = 0.f;
  uint64_t                       stepCount_    = 0;
};

} // namespace pachinball
