#pragma once

#include <cmath>

namespace pachinball {

/** Minimal 3-component vector used throughout the physics engine. */
struct Vec3 {
  float x = 0.f, y = 0.f, z = 0.f;

  Vec3() = default;
  Vec3(float x, float y, float z) : x(x), y(y), z(z) {}

  Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(float s)        const { return {x * s,   y * s,   z * s  }; }
  Vec3 operator/(float s)        const { return {x / s,   y / s,   z / s  }; }
  Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
  Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
  Vec3& operator*=(float s)       { x *= s;   y *= s;   z *= s;   return *this; }

  float dot(const Vec3& o) const { return x*o.x + y*o.y + z*o.z; }
  Vec3  cross(const Vec3& o) const {
    return {y*o.z - z*o.y, z*o.x - x*o.z, x*o.y - y*o.x};
  }
  float lengthSq() const { return x*x + y*y + z*z; }
  float length()   const { return std::sqrt(lengthSq()); }
  Vec3  normalized() const {
    float len = length();
    return len > 1e-9f ? (*this / len) : Vec3{0.f, 1.f, 0.f};
  }

  static Vec3 zero()  { return {0.f, 0.f,  0.f}; }
  static Vec3 up()    { return {0.f, 1.f,  0.f}; }
  static Vec3 down()  { return {0.f, -1.f, 0.f}; }
};

/** Unit quaternion for orientation. Stored as (x, y, z, w). */
struct Quat {
  float x = 0.f, y = 0.f, z = 0.f, w = 1.f;

  Quat() = default;
  Quat(float x, float y, float z, float w) : x(x), y(y), z(z), w(w) {}

  static Quat identity() { return {0.f, 0.f, 0.f, 1.f}; }

  Quat operator*(const Quat& o) const {
    return {
       w*o.x + x*o.w + y*o.z - z*o.y,
       w*o.y - x*o.z + y*o.w + z*o.x,
       w*o.z + x*o.y - y*o.x + z*o.w,
       w*o.w - x*o.x - y*o.y - z*o.z
    };
  }

  Vec3 rotate(const Vec3& v) const {
    // Rodrigues rotation via quaternion
    Vec3 qv{x, y, z};
    Vec3 uv  = qv.cross(v);
    Vec3 uuv = qv.cross(uv);
    return v + (uv * (2.f * w)) + (uuv * 2.f);
  }
};

/** Rigid-body transform: position + orientation. */
struct Transform {
  Vec3 position;
  Quat rotation;

  Transform() = default;
  Transform(Vec3 p, Quat r) : position(p), rotation(r) {}

  static Transform identity() {
    return {Vec3::zero(), Quat::identity()};
  }
};

} // namespace pachinball
