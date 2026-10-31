#pragma once

#include "MathTypes.h"
#include "BodyDesc.h"
#include "ContactListener.h"
#include "BodyStore.h"
#include "CollisionFilter.h"
#include "HandleTable.h"
#include "BroadphaseGrid.h"
#include "HingeJoint.h"
#include "KinematicMover.h"
#include "SensorVolume.h"
#include "StaticShapes.h"
#include "TriangleMesh.h"
#include "ForceField.h"
#include "PinField.h"
#include "Snapshot.h"

#include <algorithm>
#include <cmath>
#include <vector>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <functional>

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
// STATIC_CYLINDER_ID_BASE (-5000) in StaticShapes.h;
// STATIC_MESH_ID_BASE (-6000) in TriangleMesh.h;
// FORCE_FIELD_ID_BASE (-7000) in ForceField.h;
// STATIC_SPHERE_ID_BASE (-8000) and STATIC_CONE_ID_BASE (-9000) in StaticShapes.h;
// PIN_FIELD_ID_BASE (-10000) in PinField.h.

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

/** `WorldParams::maxSubsteps` default, and its upper bound (see sanitizedMaxSubsteps). */
inline constexpr float DEFAULT_MAX_SUBSTEPS = 8.f;
inline constexpr float MAX_SUBSTEPS_LIMIT   = 64.f;

/**
 * The substep cap `step()` actually uses. `maxSubsteps` is a float — it is a
 * WorldParams field (Embind value_object) and is read back from snapshot
 * bytes — and casting NaN or ±inf to int is UB. NaN falls back to the
 * default; everything else is clamped to [1, 64], so a cap below 1 can no
 * longer freeze the world. The identity on every value in that range.
 */
inline float sanitizedMaxSubsteps(float maxSubsteps) {
  if (std::isnan(maxSubsteps)) return DEFAULT_MAX_SUBSTEPS;
  return std::min(std::max(maxSubsteps, 1.f), MAX_SUBSTEPS_LIMIT);
}

/**
 * A dynamic body found with a non-finite pose or velocity and frozen
 * (PhysicsWorldStep.cpp, "Non-finite quarantine"): put back where its
 * substep started — the origin / identity if that pose was not finite
 * either — with zero velocity, asleep. The engine only freezes; what the
 * game does with the ball (stuck-ball rescue, score-neutral drain) is its call.
 */
struct NaNQuarantine {
  int      bodyId  = -1;
  uint64_t step    = 0;  ///< getStepCount() when its substep began (substeps since creation)
  int      substep = 0;  ///< That substep's index within its step() call
};

/** Per-world simulation parameters. */
struct WorldParams {
  Vec3  gravity          = {0.f, -9.81f, -5.0f};
  float fixedTimestep    = 1.f / 60.f;
  float maxSubsteps      = DEFAULT_MAX_SUBSTEPS;
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

  /**
   * Add an oriented static cone (local Y axis, apex at +halfHeight), matching
   * Rapier's `ColliderDesc.cone(halfHeight, radius)`. Ball-trap funnels.
   * @returns negative handle.
   */
  int addStaticCone(float px, float py, float pz,
                    float radius, float halfHeight,
                    float qx, float qy, float qz, float qw,
                    float restitution = 0.4f,
                    float friction = 0.2f);

  /**
   * Add a whole pachinko pin lattice as ONE static collider (PinField.h).
   * Consumes a single slot of the pin-field family, however many pins it
   * holds; contacts report the field id with the pin's lattice index in
   * `ContactEvent::subIndex`. @returns negative handle.
   */
  int addPinField(const PinFieldDesc& desc);

  /** Pins a field actually holds after mask / keep-outs / dropout, or -1 for an unknown id. */
  int getPinFieldPinCount(int fieldId) const;

  /** Add a static sphere collider. @returns negative handle. */
  int addStaticSphere(float px, float py, float pz,
                      float radius,
                      float restitution = 0.4f,
                      float friction = 0.2f);

  /**
   * Add an immutable static triangle mesh from world-space vertex/index
   * arrays (`vertices` is 3 floats per vertex, `indices` 3 per triangle).
   * Adventure ramps, walls and floors arrive through here.
   * Degenerate (zero-area) triangles are dropped. @returns negative handle,
   * or `STATIC_HANDLE_OVERFLOW` (adding no triangle) once 1000 meshes exist.
   */
  int addStaticTriangleMesh(const float* vertices, int vertexCount,
                            const uint32_t* indices, int indexCount,
                            float restitution = 0.4f,
                            float friction = 0.2f,
                            bool doubleSided = false);

  /**
   * Drop every static, kinematic and force-field collider — boxes, capsules,
   * cylinders, meshes, sensors, movers, fields and planes — and reset the
   * broadphase's static cells.
   *
   * All negative handles previously returned by `add*()` are invalidated, so
   * the caller must re-export everything it still wants. Needed because an
   * adventure track switch replaces the whole static world; rigid bodies are
   * unaffected.
   */
  void clearStaticGeometry();

  /**
   * Add an oriented box force region (updraft, conveyor, solar wind).
   * @returns negative handle, or `STATIC_HANDLE_OVERFLOW` once 1000 fields exist.
   */
  int addForceField(const ForceFieldDesc& desc);

  /** Toggle a force field without removing it (gates a conveyor on and off). */
  void setForceFieldEnabled(int fieldId, bool enabled);

  /** Retarget a force field's vector, keeping its region and mode. */
  void setForceFieldVector(int fieldId, float fx, float fy, float fz);

  /** Add a kinematic mover (piston, platter, gate, rotating disc). @returns negative handle. */
  int addKinematicMover(const KinematicMoverDesc& desc);

  /**
   * Push the pose a kinematic handle should reach by the next `step()`;
   * velocity is derived from the delta. `id` is either a mover (negative, as
   * returned by `addKinematicMover`) or a rigid body (id ≥ 0) currently of
   * `BodyType::Kinematic` — see `setBodyType`. A body target sent while the
   * body is not kinematic is dropped at the step.
   */
  void setNextKinematicTransform(int id, float px, float py, float pz,
                                 float qx, float qy, float qz, float qw);

  /**
   * Change a live body's simulation type (KinematicBody.cpp) — a toy taking a
   * rolling ball into its well, then spitting it out.
   *
   * → Kinematic / Static: inverse mass and inertia drop to 0, forces stop
   *   integrating, pose is kept and velocity is zeroed. A kinematic body then
   *   moves only by `setNextKinematicTransform` targets (velocity = pose delta
   *   over the fixed tick; a tick without a target leaves it at rest). It
   *   pushes dynamic bodies it touches but, like a mover, never collides with
   *   static geometry or other movers; sensors still see it.
   * → Dynamic: mass and inertia are rebuilt from the body's creation-time
   *   mass and shape, and the last kinematic velocity is kept as its linear /
   *   angular velocity, so a release carries the well's motion.
   *
   * Hinges on the body stay attached; they cannot drive an infinite-mass body.
   */
  void setBodyType(int id, BodyType type);

  /** Current simulation type as its enum value, or -1 for an unknown id. */
  int getBodyType(int id) const;

  /** Add a static OBB trigger volume (Enter/Stay/Exit events, zero impulse). @returns negative handle. */
  int addSensorVolume(const SensorVolumeDesc& desc);

  /**
   * Set the collision-group membership/filter mask for any handle — a
   * dynamic/kinematic body (id ≥ 0) or any static/kinematic collider
   * (id < 0, as returned by the matching add*() call).
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

  // ---- Snapshots (Snapshot.cpp) ----------------------------------------
  /**
   * Versioned little-endian blob of the full solver state — see Snapshot.h
   * for what is (and deliberately is not) in it. Taken between `step()`
   * calls; pending `setNextKinematicTransform` targets are included.
   */
  std::vector<uint8_t> serialize() const;

  /**
   * Restore a `serialize()` blob. Validates everything before touching the
   * world: on any status other than `Ok` the world is left exactly as it was.
   * Refuses (`StaticMismatch`) a snapshot of a differently built table.
   * On success the packed transform buffer is re-scattered, so JS reads the
   * restored poses without stepping; the contact buffer is empty until the
   * next step.
   */
  SnapshotStatus restore(const uint8_t* data, std::size_t size);

  /**
   * FNV-1a 64 over every static collider's geometry and material (group
   * masks, mover poses and force-field vectors are runtime state,
   * snapshotted instead of hashed).
   *
   * Canonical: each family is folded as the sorted multiset of its items'
   * own digests, so two worlds holding the same statics hash equal however
   * the async cabinet / adventure build ordered the add*() calls (#464
   * item 2). Handles still follow insertion order; only the hash ignores it.
   */
  uint64_t staticContentHash() const;

  /**
   * FNV-1a 64 of the stepped world: exactly the state `serialize()` carries
   * after its header (step counter, accumulator, params, handles, every body
   * column, hinges, kinematic targets, static runtime state, the contact
   * manifold), plus `SNAPSHOT_VERSION`, `staticContentHash()` and each live
   * hinge's angle. Two worlds with equal hashes step identically; `restore()`
   * of a blob gives back the hash the world had when it was serialized. The
   * cheap equality check for headless replay verification (#444) — compare
   * hashes, ship the blob only on a mismatch. Unlike `staticContentHash()`
   * it also folds the order each static family was added in: static ids in
   * contacts and the solve order follow insertion, so an equal-content table
   * built in another order restores a blob fine but does not step
   * identically, and hashes differently. Cost is O(bodies + static content):
   * the static table is re-digested (a few small allocations) on each call.
   */
  uint64_t getStateHash() const;

  /** Contact flushes so far (ContactListener::generation). */
  uint64_t getContactGeneration() const { return contactListener_.generation(); }

  /** Static shapes refused because their family hit STATIC_HANDLE_CAPACITY. */
  int getDroppedStaticCount() const { return droppedStatics_; }

  /**
   * Bodies frozen for a non-finite state during the last `step()` call, in
   * the order they were caught (empty on a healthy step). Not snapshotted:
   * like the contact emit, it describes one call.
   */
  const std::vector<NaNQuarantine>& lastNaNQuarantines() const { return quarantines_; }

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

  void substep(float dt, int substepIndex);
  /**
   * Freeze every dynamic body whose position, rotation, velocity or angular
   * velocity is not finite (see NaNQuarantine). Runs after integration — so
   * a NaN never reaches the broadphase or the solver — and again after the
   * solve. Read-only on a healthy world.
   */
  void quarantineNonFinite(int substepIndex);
  void solveHinges(float dt);
  /** Per-family static counts in Snapshot.h header order. */
  void staticCounts(uint32_t out[SNAPSHOT_STATIC_FAMILIES]) const;
  void scatterTransforms();
  /** Content-sorted order of each static family (Snapshot.cpp, "Canonical static ordering"). */
  struct StaticRanking;
  StaticRanking staticRanking() const;
  uint64_t staticHashOf(const StaticRanking& ranking) const;
  /** Post-header snapshot payload; `Sink` is SnapshotWriter or SnapshotHasher (Snapshot.cpp). */
  template <typename Sink> void writeState(Sink& out, const StaticRanking& ranking) const;

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
  void resolveSphereVsCylinder(BodyView& body, const CylinderDesc& cyl, int cylId, int subIndex = 0);
  // ---- Pin fields (PinField.cpp) ----------------------------------------
  /** Broadphase half: one AABB test per (awake sphere, field), appended to `pairs_`. */
  void appendPinFieldPairs();
  void resolveSphereVsPinField(BodyView& body, int fieldIndex);
  void resolveSphereVsStaticSphere(BodyView& body, const SphereDesc& sph, int sphId);
  // ---- Static cone (Cone.cpp) -------------------------------------------
  void resolveSphereVsCone(BodyView& body, const ConeDesc& cone, int coneId);
  // ---- Static triangle meshes (TriangleMesh.cpp) ------------------------
  void resolveSphereVsTriangle(BodyView& body, int triangleIndex);

  // ---- Force fields (ForceField.cpp) ------------------------------------
  /** Accumulate every enabled field's contribution; runs just before integration. */
  void applyForceFields();

  // ---- Kinematic bodies (KinematicBody.cpp) -----------------------------
  struct KinematicBodyTarget {
    int  id;
    Vec3 position;
    Quat rotation;
  };
  void pushKinematicBodyTarget(int id, const Vec3& position, const Quat& rotation);
  /** Commit this tick's body targets (once per `step()`, before the substeps). */
  void advanceKinematicBodies(float dt);

  // ---- Dynamic boxes (DynamicBox.cpp) -----------------------------------
  /**
   * Point query against a static surface: returns whether `worldPoint` is
   * inside it and, if so, the outward contact normal and penetration depth.
   */
  using SurfacePointQuery = std::function<bool(const Vec3& worldPoint,
                                               Vec3& outNormal, float& outPenetration)>;
  void resolveSphereVsBoxBody(BodyView& sphere, BodyView& box);
  void resolveBoxCorners(BodyView& box, int otherId,
                         float otherRestitution, float otherFriction,
                         const SurfacePointQuery& query);
  void resolveBoxBodyVsPlane(BodyView& box, const PlaneDesc& plane);
  void resolveBoxBodyVsBox(BodyView& box, const BoxDesc& other, int otherId);
  void resolveBoxBodyVsTriangle(BodyView& box, int triangleIndex);

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
  /**
   * Record every body's pose as the start of the segment the next substep
   * sweeps against sensors. Taken before the kinematic targets land (so a
   * captured ball's jump is swept) and after each substep (so a later substep
   * of the same `step()` starts where the last one ended). A teleport between
   * steps (`setBodyPosition`) is therefore never swept.
   */
  void capturePreviousPositions();
  void resolveSphereVsSensor(BodyView& body, int sensorIndex);
  void resolveCapsuleVsSensor(BodyView& body, int sensorIndex);
  /** Shared overlap emit — `queryPoint` is the body point nearest the volume. */
  void emitSensorOverlap(BodyView& body, int sensorIndex, const Vec3& queryPoint);

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
  std::vector<ConeDesc>          cones_;
  std::vector<PinField>          pinFields_;
  std::vector<KinematicMover>    movers_;
  std::vector<SensorVolumeDesc>  sensors_;
  std::vector<TriangleMeshDesc>  meshes_;
  /** Flat, world-space triangle soup across every mesh; indices are stable. */
  std::vector<MeshTriangle>      triangles_;
  std::vector<ForceFieldDesc>    fields_;
  std::vector<HingeJoint>        hinges_;
  /** Body targets pushed since the last `step()` (last push per id wins). */
  std::vector<KinematicBodyTarget> bodyTargets_;
  /** Bodies a target moved during the previous `step()`. */
  std::vector<int>               drivenBodies_;
  /**
   * Dense-indexed start pose of the current substep (see capturePreviousPositions).
   * Transient: re-taken at the top of every `step()`, so it is not snapshotted.
   */
  std::vector<Vec3>              prevPositions_;
  /** Dense-indexed rotation at the start of the current substep (quarantine restore). Transient. */
  std::vector<Quat>              substepStartRotations_;
  std::vector<NaNQuarantine>     quarantines_;
  int                            nextHingeId_ = 0;
  ContactListener                contactListener_;

  float*                         transformBuffer_ = nullptr;
  std::size_t                    transformCapSlots_ = 0;

  int                            droppedStatics_ = 0;

  float                          accumulator_  = 0.f;
  uint64_t                       stepCount_    = 0;
};

} // namespace pachinball
