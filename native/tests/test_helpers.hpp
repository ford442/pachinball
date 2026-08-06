#pragma once

#include "PhysicsWorld.h"
#include <cmath>

namespace pachinball::test {

inline constexpr float FIXED_DT = 1.f / 60.f;

inline bool near(float a, float b, float eps = 1e-3f) {
  return std::fabs(a - b) <= eps;
}

inline Vec3 readPos(const PhysicsWorld& world, int id) {
  float x = 0.f, y = 0.f, z = 0.f;
  world.getPosition(id, &x, &y, &z);
  return {x, y, z};
}

inline Vec3 readVel(const PhysicsWorld& world, int id) {
  float x = 0.f, y = 0.f, z = 0.f;
  world.getVelocity(id, &x, &y, &z);
  return {x, y, z};
}

inline void stepFixed(PhysicsWorld& world, int steps) {
  for (int i = 0; i < steps; ++i) {
    world.step(FIXED_DT);
  }
}

inline bool isFinite(float v) {
  return std::isfinite(v);
}

inline bool isFinite(const Vec3& v) {
  return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
}

} // namespace pachinball::test
