#pragma once

/**
 * Input checks at the engine boundary (#520 row 10): every value that enters
 * from JS (bindings.cpp) or a native caller and would otherwise be cast or
 * used unchecked — enum tags, rotations, plane normals.
 *
 * The policy is sanitise, not refuse. A refused add*() or createRigidBody()
 * would skip an id the worker client's WasmIdShadow has already handed out
 * (physics-worker-protocol.ts), so an out-of-range enum becomes the default
 * it already behaved as, and a bad rotation becomes the identity. A plane has
 * no handle, so it is the one thing refused outright.
 *
 * Bit-identity: a value already in range is returned unchanged, to the bit.
 * In particular a rotation within UNIT_LENGTH_SQ_TOLERANCE of unit length —
 * any caller's float32 rounding of a unit quaternion — is kept as given, so a
 * healthy world steps exactly as it did before these checks existed.
 */

#include "BodyDesc.h"
#include "ForceField.h"
#include "MathTypes.h"
#include "VolumeShape.h"

#include <cmath>

namespace pachinball {

/**
 * |lengthSq − 1| a rotation or direction may be off by and still count as
 * unit. float32 rounding of a unit quaternion is ~1e-7; 1e-4 bounds the
 * scale a near-unit rotation applies (|q|² · v) to 0.01 %.
 */
inline constexpr float UNIT_LENGTH_SQ_TOLERANCE = 1e-4f;

/** Integer tag → enum, or `fallback` when it names no enumerator. */
template <typename E>
constexpr E enumFromInt(int value, E last, E fallback) {
  return (value >= 0 && value <= static_cast<int>(last)) ? static_cast<E>(value) : fallback;
}

constexpr BodyType bodyTypeFromInt(int v) {
  return enumFromInt(v, BodyType::Kinematic, BodyType::Dynamic);
}
constexpr Shape shapeFromInt(int v) {
  return enumFromInt(v, Shape::Box, Shape::Sphere);
}
constexpr VolumeShape volumeShapeFromInt(int v) {
  return enumFromInt(v, VolumeShape::Sphere, VolumeShape::Box);
}
constexpr ForceSpace forceSpaceFromInt(int v) {
  return enumFromInt(v, ForceSpace::Local, ForceSpace::World);
}
constexpr ForceMode forceModeFromInt(int v) {
  return enumFromInt(v, ForceMode::AxisPull, ForceMode::Directional);
}

/** An enum value that arrived through a struct (native callers, Embind value_objects). */
constexpr BodyType sanitized(BodyType t) {
  return bodyTypeFromInt(static_cast<int>(t));
}
constexpr Shape sanitized(Shape s) {
  return shapeFromInt(static_cast<int>(s));
}
constexpr VolumeShape sanitized(VolumeShape s) {
  return volumeShapeFromInt(static_cast<int>(s));
}
constexpr ForceSpace sanitized(ForceSpace s) {
  return forceSpaceFromInt(static_cast<int>(s));
}
constexpr ForceMode sanitized(ForceMode m) {
  return forceModeFromInt(static_cast<int>(m));
}

inline bool isFiniteVec3(const Vec3& v) {
  return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

inline bool isFiniteQuat(const Quat& q) {
  return std::isfinite(q.x) && std::isfinite(q.y) && std::isfinite(q.z) && std::isfinite(q.w);
}

/** True for a finite quaternion within UNIT_LENGTH_SQ_TOLERANCE of unit length. */
inline bool isUnitQuat(const Quat& q) {
  return isFiniteQuat(q) && std::fabs(q.lengthSq() - 1.f) <= UNIT_LENGTH_SQ_TOLERANCE;
}

/** True for a finite vector within UNIT_LENGTH_SQ_TOLERANCE of unit length. */
inline bool isUnitVec3(const Vec3& v) {
  return isFiniteVec3(v) && std::fabs(v.lengthSq() - 1.f) <= UNIT_LENGTH_SQ_TOLERANCE;
}

/**
 * A rotation fit to store: near-unit input unchanged, anything else finite and
 * non-zero normalised (scaled by its largest component first, so 1e30 or 1e-30
 * components neither overflow nor underflow), zero or non-finite → identity.
 */
inline Quat sanitizedRotation(const Quat& q) {
  if (isUnitQuat(q)) return q;
  if (!isFiniteQuat(q)) return Quat::identity();
  const float m = std::fmax(std::fmax(std::fabs(q.x), std::fabs(q.y)), std::fmax(std::fabs(q.z), std::fabs(q.w)));
  if (!(m > 0.f)) return Quat::identity();
  const Quat scaled{q.x / m, q.y / m, q.z / m, q.w / m};
  return scaled.normalized();
}

/**
 * A direction fit to store (plane normal): near-unit input unchanged, anything
 * else finite and non-zero normalised. False — `out` untouched — for a zero or
 * non-finite vector, which names no direction.
 */
inline bool sanitizedDirection(const Vec3& v, Vec3& out) {
  if (isUnitVec3(v)) {
    out = v;
    return true;
  }
  if (!isFiniteVec3(v)) return false;
  const float m = std::fmax(std::fmax(std::fabs(v.x), std::fabs(v.y)), std::fabs(v.z));
  if (!(m > 0.f)) return false;
  const Vec3 scaled{v.x / m, v.y / m, v.z / m};
  out = scaled / scaled.length();
  return true;
}

} // namespace pachinball
