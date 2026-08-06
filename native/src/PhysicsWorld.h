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
};

/** Oriented static box collider (half-extents in local space). */
struct BoxDesc {
  Vec3  center       = Vec3::zero();
  Vec3  halfExtents  = {0.5f, 0.5f, 0.5f};
  Quat  rotation     = Quat::identity();
  float restitution  = 0.4f;
};

/** Oriented static capsule collider (local Y is the segment axis). */
struct CapsuleDesc {
  Vec3  center      = Vec3::zero();
  float radius      = 0.1f;
  float halfHeight  = 0.5f; ///< Half-length of the cylindrical section
  Quat  rotation    = Quat::identity();
  float restitution = 0.4f;
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
 * Response: single-pass sequential impulse with position correction.
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

  /** Set the world-space velocity of a body directly. */
  void setVelocity(int id, float vx, float vy, float vz);

  /** Directly set the world-space position of a body. */
  void setBodyPosition(int id, float px, float py, float pz);

  /** Directly set the world-space rotation of a body. */
  void setBodyRotation(int id, float qx, float qy, float qz, float qw);

  // ---- Static geometry ------------------------------------------------

  /** Add a static infinite half-space plane. */
  void addStaticPlane(float nx, float ny, float nz, float distance);

  /**
   * Add an oriented static box collider.
   * @returns Stable negative collider id for contact events.
   */
  int addStaticBox(float px, float py, float pz,
                   float hx, float hy, float hz,
                   float qx, float qy, float qz, float qw,
                   float restitution = 0.4f);

  /**
   * Add an oriented static capsule collider (local Y axis).
   * @returns Stable negative collider id for contact events.
   */
  int addStaticCapsule(float px, float py, float pz,
                       float radius, float halfHeight,
                       float qx, float qy, float qz, float qw,
                       float restitution = 0.4f);

  // ---- Transform queries ----------------------------------------------

  /** Fill (px,py,pz) with the body's current world position. */
  void getPosition(int id, float* px, float* py, float* pz) const;

  /** Fill (vx,vy,vz) with the body's current velocity. */
  void getVelocity(int id, float* vx, float* vy, float* vz) const;

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

  // ---- World config ---------------------------------------------------

  void setGravity(float gx, float gy, float gz) {
    params_.gravity = {gx, gy, gz};
  }

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

  // Narrow-phase collision detection + response
  void resolveSphereVsSphere(RigidBody& a, RigidBody& b);
  void resolveSphereVsPlane(RigidBody& body, const PlaneDesc& plane);
  void resolveSphereVsBox(RigidBody& body, const BoxDesc& box, int boxId);
  void resolveSphereVsCapsule(RigidBody& body, const CapsuleDesc& cap, int capId);
};

} // namespace pachinball
