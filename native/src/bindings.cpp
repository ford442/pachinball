/**
 * Emscripten bindings for the Pachinball C++ physics engine.
 *
 * Build via: npm run build:wasm (see scripts/build-wasm.sh + native/CMakeLists.txt)
 *
 * Contact callbacks use embind val (setContactCallbackJS), not addFunction.
 * JS reads contact/transform buffers via Module.HEAPF32.
 */

#include <emscripten/bind.h>
#include "PhysicsWorld.h"
#include <cstdint>

using namespace emscripten;
using namespace pachinball;

// ---------------------------------------------------------------------------
// Thin contact-event shim (legacy per-event path — prefer the packed buffer)
// ---------------------------------------------------------------------------
// From JavaScript the callback will be:
//   world.setContactCallbackJS(function(id1, id2, nx, ny, nz, px, py, pz, impulse, phase) { … })
//
static void setContactCallbackJS(PhysicsWorld& world, emscripten::val jsCallback) {
  world.setContactCallback([jsCallback](const ContactEvent& evt) {
    jsCallback.call<void>(
        "call",
        emscripten::val::undefined(),
        evt.bodyId1, evt.bodyId2,
        evt.normal.x, evt.normal.y, evt.normal.z,
        evt.point.x,  evt.point.y,  evt.point.z,
        evt.impulse,
        static_cast<int>(evt.phase)
    );
  });
}

// ---------------------------------------------------------------------------
// Bind RigidBodyDesc
// ---------------------------------------------------------------------------
EMSCRIPTEN_BINDINGS(rigid_body_desc) {
  // Expose BodyType enum so JS can pass typed constants
  enum_<BodyType>("BodyType")
    .value("Dynamic",   BodyType::Dynamic)
    .value("Static",    BodyType::Static)
    .value("Kinematic", BodyType::Kinematic);

  // Expose Shape enum so JS can pass typed constants
  enum_<Shape>("Shape")
    .value("Sphere",  Shape::Sphere)
    .value("Capsule", Shape::Capsule);

  // Expose Vec3 so JS can construct positions/velocities conveniently
  value_object<Vec3>("Vec3")
    .field("x", &Vec3::x)
    .field("y", &Vec3::y)
    .field("z", &Vec3::z);

  // Expose WorldParams for advanced configuration
  value_object<WorldParams>("WorldParams")
    .field("fixedTimestep",     &WorldParams::fixedTimestep)
    .field("maxSubsteps",       &WorldParams::maxSubsteps)
    .field("solverIterations",  &WorldParams::solverIterations)
    .field("rollingResistance", &WorldParams::rollingResistance);

  // Bound descriptor so JS can pass a single object instead of 15 positionals.
  value_object<RigidBodyDesc>("RigidBodyDesc")
    .field("position",          &RigidBodyDesc::position)
    .field("velocity",          &RigidBodyDesc::velocity)
    .field("mass",              &RigidBodyDesc::mass)
    .field("radius",            &RigidBodyDesc::radius)
    .field("restitution",       &RigidBodyDesc::restitution)
    .field("linearDamping",     &RigidBodyDesc::linearDamping)
    .field("type",              &RigidBodyDesc::type)
    .field("shape",             &RigidBodyDesc::shape)
    .field("capsuleHalfHeight", &RigidBodyDesc::capsuleHalfHeight)
    .field("friction",          &RigidBodyDesc::friction)
    .field("angularDamping",    &RigidBodyDesc::angularDamping);

  value_object<HingeDesc>("HingeDesc")
    .field("worldAnchor",    &HingeDesc::worldAnchor)
    .field("worldAxis",      &HingeDesc::worldAxis)
    .field("minAngle",       &HingeDesc::minAngle)
    .field("maxAngle",       &HingeDesc::maxAngle)
    .field("motorTargetVel", &HingeDesc::motorTargetVel)
    .field("motorMaxTorque", &HingeDesc::motorMaxTorque)
    .field("baumgarte",      &HingeDesc::baumgarte);
}

// ---------------------------------------------------------------------------
// Bind PhysicsWorld
// ---------------------------------------------------------------------------
EMSCRIPTEN_BINDINGS(physics_world) {
  class_<PhysicsWorld>("PhysicsWorld")
    .constructor<>()

    // Body management
    .function("createRigidBody",  optional_override([](PhysicsWorld& self,
        float px, float py, float pz,
        float vx, float vy, float vz,
        float mass, float radius, float restitution, float linearDamping,
        int bodyType, int shape, float capsuleHalfHeight,
        float friction, float angularDamping) -> int {
          RigidBodyDesc desc;
          desc.position      = {px, py, pz};
          desc.velocity      = {vx, vy, vz};
          desc.mass          = mass;
          desc.radius        = radius;
          desc.restitution   = restitution;
          desc.linearDamping = linearDamping;
          desc.type          = static_cast<BodyType>(bodyType);
          desc.shape         = static_cast<Shape>(shape);
          desc.capsuleHalfHeight = capsuleHalfHeight;
          desc.friction          = friction;
          desc.angularDamping    = angularDamping;
          return self.createRigidBody(desc);
        }))
    .function("createRigidBodyDesc", &PhysicsWorld::createRigidBody)
    .function("removeRigidBody",  &PhysicsWorld::removeRigidBody)

    // Force / velocity control
    .function("applyForce",   &PhysicsWorld::applyForce)
    .function("applyImpulse", &PhysicsWorld::applyImpulse)
    .function("setVelocity",  &PhysicsWorld::setVelocity)
    .function("setAngularVelocity", &PhysicsWorld::setAngularVelocity)
    .function("setBodyPosition", &PhysicsWorld::setBodyPosition)
    .function("setBodyRotation", &PhysicsWorld::setBodyRotation)

    .function("createHinge", optional_override([](PhysicsWorld& self,
        int bodyId,
        float ax, float ay, float az,
        float nx, float ny, float nz,
        float minAngle, float maxAngle) -> int {
          HingeDesc desc;
          desc.worldAnchor = {ax, ay, az};
          desc.worldAxis = {nx, ny, nz};
          desc.minAngle = minAngle;
          desc.maxAngle = maxAngle;
          return self.createHinge(bodyId, desc);
        }))
    .function("setHingeMotor", &PhysicsWorld::setHingeMotor)
    .function("getHingeAngle", &PhysicsWorld::getHingeAngle)
    .function("removeHinge", &PhysicsWorld::removeHinge)

    // Static geometry
    .function("addStaticPlane", &PhysicsWorld::addStaticPlane)
    .function("addStaticBox",    &PhysicsWorld::addStaticBox)
    .function("addStaticCapsule", &PhysicsWorld::addStaticCapsule)

    // Queries — JS side uses simple return-value helpers
    .function("getPosX", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getPosition(id,&x,&y,&z); return x; }))
    .function("getPosY", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getPosition(id,&x,&y,&z); return y; }))
    .function("getPosZ", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getPosition(id,&x,&y,&z); return z; }))

    .function("getVelX", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getVelocity(id,&x,&y,&z); return x; }))
    .function("getVelY", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getVelocity(id,&x,&y,&z); return y; }))
    .function("getVelZ", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getVelocity(id,&x,&y,&z); return z; }))

    .function("getAngVelX", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getAngularVelocity(id,&x,&y,&z); return x; }))
    .function("getAngVelY", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getAngularVelocity(id,&x,&y,&z); return y; }))
    .function("getAngVelZ", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0; self.getAngularVelocity(id,&x,&y,&z); return z; }))

    .function("getRotX", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0,w=1; self.getRotation(id,&x,&y,&z,&w); return x; }))
    .function("getRotY", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0,w=1; self.getRotation(id,&x,&y,&z,&w); return y; }))
    .function("getRotZ", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0,w=1; self.getRotation(id,&x,&y,&z,&w); return z; }))
    .function("getRotW", optional_override([](PhysicsWorld& self, int id) -> float {
        float x=0,y=0,z=0,w=1; self.getRotation(id,&x,&y,&z,&w); return w; }))

    // Simulation
    .function("step",               &PhysicsWorld::step)
    .function("getStepCount",       optional_override([](PhysicsWorld& self) -> double {
        return static_cast<double>(self.getStepCount()); }))
    .function("getActiveBodyCount", &PhysicsWorld::getActiveBodyCount)

    // World config
    .function("setGravity", &PhysicsWorld::setGravity)
    .function("setRollingResistance", &PhysicsWorld::setRollingResistance)
    .function("getRollingResistance", &PhysicsWorld::getRollingResistance)

    // Packed contact buffer (one JS boundary crossing per step)
    .function("getContactBufferPtr", optional_override([](PhysicsWorld& self) -> uintptr_t {
        return reinterpret_cast<uintptr_t>(self.getContactBufferPtr());
      }))
    .function("getContactCount", &PhysicsWorld::getContactCount)
    .function("getDroppedContactCount", &PhysicsWorld::getDroppedContactCount)
    .function("setMaxContacts", &PhysicsWorld::setMaxContacts)
    .function("getMaxContacts", &PhysicsWorld::getMaxContacts)

    // Packed transform buffer (zero-copy body state reads)
    .function("getTransformBufferPtr", optional_override([](PhysicsWorld& self) -> uintptr_t {
        return reinterpret_cast<uintptr_t>(self.getTransformBufferPtr());
      }))
    .function("getTransformStride", &PhysicsWorld::getTransformStride)
    .function("getTransformSlotCount", &PhysicsWorld::getTransformSlotCount)

    // Legacy per-event callback (tests / debug). Production uses the packed buffer.
    .function("setContactCallbackJS", &setContactCallbackJS);
}
