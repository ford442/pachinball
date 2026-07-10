/**
 * Emscripten bindings for the Pachinball C++ physics engine.
 *
 * Compile with:
 *   emcc  PhysicsWorld.cpp RigidBody.cpp bindings.cpp
 *         -I. -std=c++17 -O2
 *         -s MODULARIZE=1 -s EXPORT_ES6=1
 *         -s EXPORT_NAME=PhysicsModule
 *         -s ALLOW_MEMORY_GROWTH=1
 *         -s EXPORTED_RUNTIME_METHODS='["addFunction","removeFunction"]'
 *         --bind
 *         -o ../build/PhysicsModule.js
 *
 * The resulting PhysicsModule.js + PhysicsModule.wasm pair can be imported
 * directly in the Vite/TypeScript project as an ES module:
 *
 *   import PhysicsModuleFactory from './wasm/PhysicsModule.js'
 *   const Module = await PhysicsModuleFactory()
 *   const world  = new Module.PhysicsWorld()
 */

#include <emscripten/bind.h>
#include "PhysicsWorld.h"

using namespace emscripten;
using namespace pachinball;

// ---------------------------------------------------------------------------
// Thin contact-event shim
// ---------------------------------------------------------------------------
// emscripten::function callbacks receive plain values, not C++ structs, so we
// expose a helper that sets a JavaScript callback on the world.
//
// From JavaScript the callback will be:
//   world.setContactCallbackJS(function(id1, id2, nx, ny, nz, px, py, pz, impulse, isEntering) { … })
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
        evt.isEntering
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

  // Expose Vec3 so JS can construct positions/velocities conveniently
  value_object<Vec3>("Vec3")
    .field("x", &Vec3::x)
    .field("y", &Vec3::y)
    .field("z", &Vec3::z);

  // Expose WorldParams for advanced configuration
  value_object<WorldParams>("WorldParams")
    .field("fixedTimestep",    &WorldParams::fixedTimestep)
    .field("maxSubsteps",      &WorldParams::maxSubsteps)
    .field("solverIterations", &WorldParams::solverIterations);
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
        int bodyType) -> int {
          RigidBodyDesc desc;
          desc.position      = {px, py, pz};
          desc.velocity      = {vx, vy, vz};
          desc.mass          = mass;
          desc.radius        = radius;
          desc.restitution   = restitution;
          desc.linearDamping = linearDamping;
          desc.type          = static_cast<BodyType>(bodyType);
          return self.createRigidBody(desc);
        }))
    .function("removeRigidBody",  &PhysicsWorld::removeRigidBody)

    // Force / velocity control
    .function("applyForce",   &PhysicsWorld::applyForce)
    .function("applyImpulse", &PhysicsWorld::applyImpulse)
    .function("setVelocity",  &PhysicsWorld::setVelocity)
    .function("setBodyPosition", &PhysicsWorld::setBodyPosition)
    .function("setBodyRotation", &PhysicsWorld::setBodyRotation)

    // Static geometry
    .function("addStaticPlane", &PhysicsWorld::addStaticPlane)

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

    // Contact callback
    .function("setContactCallbackJS", &setContactCallbackJS);
}
