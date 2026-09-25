/**
 * The per-tick half of PhysicsWorld: `step()` (accumulator + fixed substeps),
 * `substep()` (force fields, integration, sleep, broadphase, the contact /
 * hinge solver loop) and the packed transform-buffer scatter that follows.
 *
 * Split out of PhysicsWorld.cpp (#420) so the body/collider API file
 * stays under the house 500-line limit as runtime body types and cones land.
 * All functions here are PhysicsWorld methods — declared in PhysicsWorld.h.
 */
#include "PhysicsWorld.h"
#include "KinematicMover.h"

#include <cstdlib>
#include <cstring>

namespace pachinball {

void PhysicsWorld::freeTransformBuffer() {
  if (transformBuffer_) {
    std::free(transformBuffer_);
    transformBuffer_ = nullptr;
    transformCapSlots_ = 0;
  }
}

void PhysicsWorld::ensureTransformCapacity(int slotCount) {
  if (slotCount <= static_cast<int>(transformCapSlots_)) return;
  std::size_t bytes = static_cast<std::size_t>(slotCount) *
                      static_cast<std::size_t>(TRANSFORM_STRIDE) * sizeof(float);
  bytes = (bytes + 15u) & ~std::size_t(15);
  void* p = std::aligned_alloc(16, bytes);
  if (!p) std::abort();
  if (transformBuffer_) std::free(transformBuffer_);
  transformBuffer_ = static_cast<float*>(p);
  transformCapSlots_ = bytes / (sizeof(float) * static_cast<std::size_t>(TRANSFORM_STRIDE));
}

void PhysicsWorld::scatterTransforms() {
  const int slots = handles_.nextId();
  if (slots <= 0) return;
  ensureTransformCapacity(slots);
  const std::size_t floats = static_cast<std::size_t>(slots) * static_cast<std::size_t>(TRANSFORM_STRIDE);
  std::memset(transformBuffer_, 0, floats * sizeof(float));

  for (int i = 0; i < bodies_.denseCount(); ++i) {
    const int publicId = bodies_.publicIdAt(i);
    float* slot = transformBuffer_ + static_cast<std::size_t>(publicId) * TRANSFORM_STRIDE;
    slot[0]  = static_cast<float>(publicId);
    slot[1]  = bodies_.posX(i);
    slot[2]  = bodies_.posY(i);
    slot[3]  = bodies_.posZ(i);
    slot[4]  = bodies_.view(i).getRotation().x;
    slot[5]  = bodies_.view(i).getRotation().y;
    slot[6]  = bodies_.view(i).getRotation().z;
    slot[7]  = bodies_.view(i).getRotation().w;
    slot[8]  = bodies_.velX(i);
    slot[9]  = bodies_.velY(i);
    slot[10] = bodies_.velZ(i);
    const Vec3 w = bodies_.view(i).getAngularVelocity();
    slot[11] = w.x;
    slot[12] = w.y;
    slot[13] = w.z;
    slot[14] = bodies_.isActive(i) ? 1.f : 0.f;
  }
}

float PhysicsWorld::step(float rawDt) {
  constexpr float MAX_DT = 1.f / 30.f;
  float dt = (rawDt < MAX_DT) ? rawDt : MAX_DT;

  accumulator_ += dt;

  // Movers receive one pose push per world tick (see setNextKinematicTransform);
  // derive their velocity for this tick's substeps up front, once.
  for (KinematicMover& mover : movers_) {
    advanceKinematicMoverPose(mover, params_.fixedTimestep);
  }
  // Kinematic rigid bodies (a captured ball) follow the same one-push-per-tick contract.
  advanceKinematicBodies(params_.fixedTimestep);

  int substepsDone = 0;
  while (accumulator_ >= params_.fixedTimestep &&
         substepsDone < static_cast<int>(params_.maxSubsteps)) {
    substep(params_.fixedTimestep);
    accumulator_ -= params_.fixedTimestep;
    ++substepsDone;
    ++stepCount_;
  }

  if (substepsDone > 0) {
    contactListener_.flushEvents();
    scatterTransforms();
  }

  return accumulator_ / params_.fixedTimestep;
}

int PhysicsWorld::getActiveBodyCount() const {
  return bodies_.activeCount();
}

void PhysicsWorld::wakeOnContact(BodyView& a, BodyView* b) {
  auto wakesSleepers = [](BodyView* partner) -> bool {
    if (!partner || !partner->valid() || !partner->isActive()) return false;
    const BodyType t = partner->getType();
    return t == BodyType::Dynamic || t == BodyType::Kinematic;
  };
  if (!a.isActive() && wakesSleepers(b)) a.wake();
  if (b && b->valid() && !b->isActive() && wakesSleepers(&a)) b->wake();
}

void PhysicsWorld::substep(float dt) {
  applyForceFields();

  bodies_.integrateAll(dt, params_.gravity);

  bodies_.updateSleep(params_.sleepLinearThreshold,
                      params_.sleepAngularThreshold,
                      params_.sleepFramesRequired);

  broadphase_.buildPairs(bodies_, boxes_, capsules_, cylinders_, spheres_, cones_,
                         sensors_, movers_, triangles_, meshes_, pairs_);

  // Only dynamic bodies meet static geometry and movers: a kinematic body is
  // as immovable as they are, so no impulse can pass (Rapier reports no
  // kinematic-vs-fixed contact either). Sensors still see kinematic bodies.
  auto meetsStatics = [](const BodyView& body) {
    return body.isActive() && body.getType() == BodyType::Dynamic;
  };

  for (int iter = 0; iter < params_.solverIterations; ++iter) {
    for (const auto& pair : pairs_) {
      if (pair.type == BroadphaseGrid::Pair::BodyBody) {
        BodyView a = bodies_.view(pair.bodyA);
        BodyView b = bodies_.view(pair.bodyB);
        if (!a.isActive() || !b.isActive()) continue;
        if (a.getType() == BodyType::Static && b.getType() == BodyType::Static) continue;

        const Shape aShape = a.getShape();
        const Shape bShape = b.getShape();
        // Capsule-capsule and box-box/box-capsule stay unimplemented on
        // purpose — nothing in the game presents those pairs.
        if (aShape == bShape && aShape != Shape::Sphere) continue;
        if (aShape == Shape::Box && bShape == Shape::Sphere) {
          resolveSphereVsBoxBody(b, a);
        } else if (bShape == Shape::Box && aShape == Shape::Sphere) {
          resolveSphereVsBoxBody(a, b);
        } else if (aShape == Shape::Box || bShape == Shape::Box) {
          continue;
        } else if (aShape == Shape::Capsule) {
          resolveSphereVsCapsuleBody(b, a);
        } else if (bShape == Shape::Capsule) {
          resolveSphereVsCapsuleBody(a, b);
        } else {
          resolveSphereVsSphere(a, b);
        }
      } else if (pair.type == BroadphaseGrid::Pair::BodyBox) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!meetsStatics(body)) continue;
        const int boxId = STATIC_BOX_ID_BASE - pair.bodyB;
        const BoxDesc& box = boxes_[static_cast<std::size_t>(pair.bodyB)];
        if (body.getShape() == Shape::Box) {
          resolveBoxBodyVsBox(body, box, boxId);
        } else {
          resolveSphereVsBox(body, box, boxId);
        }
      } else if (pair.type == BroadphaseGrid::Pair::BodyCapsule) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!meetsStatics(body)) continue;
        const int capId = STATIC_CAPSULE_ID_BASE - pair.bodyB;
        resolveSphereVsCapsule(body, capsules_[static_cast<std::size_t>(pair.bodyB)], capId);
      } else if (pair.type == BroadphaseGrid::Pair::BodyCylinder) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!meetsStatics(body)) continue;
        if (body.getShape() != Shape::Sphere) continue;
        const int cylId = STATIC_CYLINDER_ID_BASE - pair.bodyB;
        resolveSphereVsCylinder(body, cylinders_[static_cast<std::size_t>(pair.bodyB)], cylId);
      } else if (pair.type == BroadphaseGrid::Pair::BodySphere) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!meetsStatics(body)) continue;
        if (body.getShape() != Shape::Sphere) continue;
        const int sphId = STATIC_SPHERE_ID_BASE - pair.bodyB;
        resolveSphereVsStaticSphere(body, spheres_[static_cast<std::size_t>(pair.bodyB)], sphId);
      } else if (pair.type == BroadphaseGrid::Pair::BodyCone) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!meetsStatics(body) || body.getShape() != Shape::Sphere) continue;
        const int coneId = STATIC_CONE_ID_BASE - pair.bodyB;
        resolveSphereVsCone(body, cones_[static_cast<std::size_t>(pair.bodyB)], coneId);
      } else if (pair.type == BroadphaseGrid::Pair::BodyTriangle) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!meetsStatics(body)) continue;
        if (body.getShape() == Shape::Box) {
          resolveBoxBodyVsTriangle(body, pair.bodyB);
        } else {
          resolveSphereVsTriangle(body, pair.bodyB);
        }
      } else if (pair.type == BroadphaseGrid::Pair::BodySensor) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!body.isActive() || body.getType() == BodyType::Static) continue;
        if (body.getShape() == Shape::Capsule) {
          resolveCapsuleVsSensor(body, pair.bodyB);
        } else {
          resolveSphereVsSensor(body, pair.bodyB);
        }
      } else if (pair.type == BroadphaseGrid::Pair::BodyMover) {
        BodyView body = bodies_.view(pair.bodyA);
        if (!meetsStatics(body)) continue;
        if (body.getShape() == Shape::Capsule) {
          resolveCapsuleVsMover(body, pair.bodyB);
        } else {
          resolveSphereVsMover(body, pair.bodyB);
        }
      }
    }

    for (int i = 0; i < bodies_.denseCount(); ++i) {
      BodyView body = bodies_.view(i);
      if (!meetsStatics(body)) continue;
      const bool isBox = body.getShape() == Shape::Box;
      for (const auto& plane : planes_) {
        if (isBox) {
          resolveBoxBodyVsPlane(body, plane);
        } else {
          resolveSphereVsPlane(body, plane);
        }
      }
    }

    solveHinges(dt);
  }
}

} // namespace pachinball
