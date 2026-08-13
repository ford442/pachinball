#pragma once

#include "MathTypes.h"
#include "RigidBody.h"
#include "ContactListener.h"

#include <vector>
#include <memory>
#include <cstdint>

namespace pachinball {

/** Parameters for creating an infinite half-space (static plane). */
struct PlaneDesc {
  Vec3  normal   = Vec3::up(); ///< Outward-facing plane normal (unit vector)
  float distance = 0.f;        ///< Signed distance from origin along the normal
  float friction = 0.2f;       ///< Coulomb friction coefficient
};

/** Oriented static box collider (half-extents in local space). */
struct BoxDesc {
  Vec3  center       = Vec3::zero();
  Vec3  halfExtents  = {0.5f, 0.5f, 0.5f};
  Quat  rotation     = Quat::identity();
  float restitution  = 0.4f;
  float friction     = 0.2f;
};

/** Oriented static capsule collider (local Y is the segment axis). */
struct CapsuleDesc {
  Vec3  center      = Vec3::zero();
  float radius      = 0.1f;
  float halfHeight  = 0.5f; ///< Half-length of the cylindrical section
  Quat  rotation    = Quat::identity();
  float restitution = 0.4f;
  float friction    = 0.2f;
};

/** Negative body IDs reserved for static colliders in contact events. */
static constexpr int STATIC_PLANE_ID    = -1;
static constexpr int STATIC_BOX_ID_BASE   = -1000;
static constexpr int STATIC_CAPSULE_ID_BASE = -2000;

/** Per-world simulation parameters. */
struct WorldParams {
  Vec3  gravity          = {0.f, -9.81f, -5.0f};  ///< m/s² (matches Rapier default)
  float fixedTimestep    = 1.f / 60.f;             ///< Seconds per physics tick
  float maxSubsteps      = 8;                      ///< Safety cap on substep count
  int   solverIterations = 4;                      ///< Velocity/position iterations
  /**
   * Rolling-resistance coefficient applied at contacts after Coulomb friction.
   * Pure Coulomb friction lets a sphere roll forever; this term bleeds spin
   * and matching tangential speed so balls settle on the playfield.
   */
  float rollingResistance = 0.04f;
};

/**
 * PhysicsWorld — minimal rigid-body simulation world.
 *
 * API mirrors the portion of Rapier's World that Pachinball uses, so that a
 * TypeScript WasmPhysicsEngine wrapper can present an identical interface to
 * PhysicsSystem without changes to game logic.
 *
 * Collision model (dynamic spheres vs static primitives):
 *   - Dynamic ↔ Dynamic   sphere-sphere
 *   - Dynamic ↔ Plane     sphere-plane
 *   - Dynamic ↔ Box       sphere-OBB
 *   - Dynamic ↔ Capsule   sphere-capsule
 * Response: sequential impulse with Coulomb friction, spherical inertia,
 * and Baumgarte position correction.
 *
 * Friction combine rule is the geometric mean μ = sqrt(μ_a * μ_b)
 * (documented as CoefficientCombineRule::GeometricMean). Restitution still
 * uses min(e_a, e_b).
 */
class PhysicsWorld {
public:
  explicit PhysicsWorld(const WorldParams& params = WorldParams{});

  // ---- Body management ------------------------------------------------

  /**
   * Create a new rigid body and return its integer handle.
   * The handle is stable for the lifetime of the body.
   */
  int  createRigidBody(const RigidBodyDesc& desc);

  /**
   * Remove a body by handle.  The handle becomes invalid after this call.
   */
  void removeRigidBody(int id);

  /** Apply a world-space force to a dynamic body (accumulated until next step). */
  void applyForce(int id, float fx, float fy, float fz);

  /** Apply an instantaneous world-space impulse to a dynamic body. */
  void applyImpulse(int id, float ix, float iy, float iz);

  /** Set the world-space linear velocity of a body directly. */
  void setVelocity(int id, float vx, float vy, float vz);

  /** Set the world-space angular velocity of a body directly. */
  void setAngularVelocity(int id, float wx, float wy, float wz);

  /** Directly set the world-space position of a body. */
  void setBodyPosition(int id, float px, float py, float pz);

  /** Directly set the world-space rotation of a body. */
  void setBodyRotation(int id, float qx, float qy, float qz, float qw);

  // ---- Static geometry ------------------------------------------------

  /** Add a static infinite half-space plane. */
  void addStaticPlane(float nx, float ny, float nz, float distance, float friction = 0.2f);

  /**
   * Add an oriented static box collider.
   * @returns Stable negative collider id for contact events.
   */
  int addStaticBox(float px, float py, float pz,
                   float hx, float hy, float hz,
                   float qx, float qy, float qz, float qw,
                   float restitution = 0.4f,
                   float friction = 0.2f);

  /**
   * Add an oriented static capsule collider (local Y axis).
   * @returns Stable negative collider id for contact events.
   */
  int addStaticCapsule(float px, float py, float pz,
                       float radius, float halfHeight,
                       float qx, float qy, float qz, float qw,
                       float restitution = 0.4f,
                       float friction = 0.2f);

  // ---- Transform queries ----------------------------------------------

  /** Fill (px,py,pz) with the body's current world position. */
  void getPosition(int id, float* px, float* py, float* pz) const;

  /** Fill (vx,vy,vz) with the body's current linear velocity. */
  void getVelocity(int id, float* vx, float* vy, float* vz) const;

  /** Fill (wx,wy,wz) with the body's current angular velocity. */
  void getAngularVelocity(int id, float* wx, float* wy, float* wz) const;

  /** Fill (qx,qy,qz,qw) with the body's current orientation quaternion. */
  void getRotation(int id, float* qx, float* qy, float* qz, float* qw) const;

  // ---- Simulation step ------------------------------------------------

  /**
   * Advance the simulation by rawDt seconds using a fixed-timestep
   * accumulator. Returns the interpolation alpha (0-1) for visual smoothing.
   */
  float step(float rawDt);

  /** Total number of substeps taken since world creation. */
  uint64_t getStepCount() const { return stepCount_; }

  /** Number of active rigid bodies (excluding removed ones). */
  int getActiveBodyCount() const;

  // ---- Contact events -------------------------------------------------

  /** Set the contact-event callback (fired once per step after resolution). */
  void setContactCallback(ContactCallback cb) {
    contactListener_.setCallback(std::move(cb));
  }

  /** Pointer to the packed float contact buffer written by the last step (12 floats/contact). */
  const float* getContactBufferPtr() const { return contactListener_.getContactBufferPtr(); }
  float* getContactBufferPtr() { return contactListener_.getContactBufferPtr(); }

  /** Number of contacts packed this step. */
  int getContactCount() const { return contactListener_.getContactCount(); }

  /** Contacts dropped this step because the cap was hit (0 when lossless). */
  int getDroppedContactCount() const { return contactListener_.getDroppedContactCount(); }

  /** Hard cap on emitted contacts per step. Default is CONTACT_DEFAULT_MAX. */
  void setMaxContacts(int max) {
    contactListener_.setMaxContacts(max > 0 ? static_cast<std::size_t>(max) : 1);
  }
  int getMaxContacts() const { return static_cast<int>(contactListener_.getMaxContacts()); }

  const std::vector<ContactEvent>& lastContactEvents() const {
    return contactListener_.lastEvents();
  }

  // ---- World config ---------------------------------------------------

  void setGravity(float gx, float gy, float gz) {
    params_.gravity = {gx, gy, gz};
  }

  void setRollingResistance(float rr) { params_.rollingResistance = rr; }
  float getRollingResistance() const { return params_.rollingResistance; }

private:
  WorldParams                          params_;
  std::vector<std::unique_ptr<RigidBody>> bodies_;
  std::vector<PlaneDesc>               planes_;
  std::vector<BoxDesc>                 boxes_;
  std::vector<CapsuleDesc>             capsules_;
  ContactListener                      contactListener_;
  float                                accumulator_  = 0.f;
  uint64_t                             stepCount_    = 0;
  int                                  nextId_       = 0;

  RigidBody* findBody(int id);
  const RigidBody* findBody(int id) const;

  // Single fixed-timestep tick
  void substep(float dt);

  /**
   * Shared normal + Coulomb friction + rolling-resistance response.
   * `b` may be null (static geometry). Returns the normal impulse magnitude.
   */
  float applyContactImpulse(RigidBody& a, RigidBody* b,
                            const Vec3& contactPoint, const Vec3& normal,
                            float restitution, float friction,
                            float penetration = 0.f);

  // Narrow-phase collision detection + response
  void resolveSphereVsSphere(RigidBody& a, RigidBody& b);
  void resolveSphereVsPlane(RigidBody& body, const PlaneDesc& plane);
  void resolveSphereVsBox(RigidBody& body, const BoxDesc& box, int boxId);
  void resolveSphereVsCapsule(RigidBody& body, const CapsuleDesc& cap, int capId);
  // Dynamic sphere vs. a Kinematic/Dynamic capsule-shaped RigidBody (e.g. a flipper proxy).
  // `capsule`'s own velocity participates in the impulse response, unlike the static-geometry
  // path above, so a moving kinematic capsule correctly imparts momentum onto `sphere`.
  void resolveSphereVsCapsuleBody(RigidBody& sphere, RigidBody& capsule);

  // Shared closest-point-on-segment projection used by both the static-capsule and
  // body-capsule collision paths.
  static Vec3 closestPointOnSegment(const Vec3& p, const Vec3& segA, const Vec3& segB);
};

} // namespace pachinball
