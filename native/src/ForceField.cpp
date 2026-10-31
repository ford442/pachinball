/**
 * Force-field application pass. Runs once per substep immediately before
 * integration, so a field's contribution lands in the same accumulator as
 * gravity and is swept up by the existing `clearForces()` at integrate time.
 */
#include "ForceField.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <cmath>

namespace pachinball {

namespace {

/** Inside this distance of the axis the pull direction is undefined; apply nothing. */
constexpr float AXIS_PULL_DEAD_ZONE = 1e-3f;

/**
 * Index of a force-field handle, or -1 when `fieldId` names no field. The
 * base check comes first: `BASE - fieldId` overflows (UB) for ids above it,
 * STATIC_HANDLE_OVERFLOW among them, and none of those is a field.
 */
int forceFieldIndex(int fieldId, std::size_t count) {
  if (fieldId > FORCE_FIELD_ID_BASE) return -1;
  const std::size_t idx = static_cast<std::size_t>(FORCE_FIELD_ID_BASE - fieldId);
  return idx < count ? static_cast<int>(idx) : -1;
}

} // namespace

int PhysicsWorld::addForceField(const ForceFieldDesc& desc) {
  if (fields_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  fields_.push_back(desc);
  return FORCE_FIELD_ID_BASE - (static_cast<int>(fields_.size()) - 1);
}

void PhysicsWorld::setForceFieldEnabled(int fieldId, bool enabled) {
  const int idx = forceFieldIndex(fieldId, fields_.size());
  if (idx < 0) return;
  fields_[static_cast<std::size_t>(idx)].enabled = enabled;
}

void PhysicsWorld::setForceFieldVector(int fieldId, float fx, float fy, float fz) {
  const int idx = forceFieldIndex(fieldId, fields_.size());
  if (idx < 0) return;
  fields_[static_cast<std::size_t>(idx)].force = {fx, fy, fz};
}

void PhysicsWorld::applyForceFields() {
  if (fields_.empty()) return;

  for (int i = 0; i < bodies_.denseCount(); ++i) {
    BodyView body = bodies_.view(i);
    if (!body.valid()) continue;
    if (body.getType() != BodyType::Dynamic) continue;

    const float mass = body.getMass();
    if (mass <= 0.f) continue;

    for (const ForceFieldDesc& field : fields_) {
      if (!field.enabled) continue;
      if (!groupsInteract(body.getMembership(), body.getFilter(),
                          field.membership, field.filter)) continue;

      const Vec3 local = field.rotation.conjugate().rotate(body.getPosition() - field.center);

      Vec3 dir;
      if (field.mode == ForceMode::AxisPull) {
        const float radius = field.halfExtents.x;
        const float d = std::sqrt(local.x * local.x + local.z * local.z);
        if (std::fabs(local.y) > field.halfExtents.y) continue;
        if (d > radius || d < AXIS_PULL_DEAD_ZONE) continue;
        const Vec3 towardAxis = field.rotation.rotate(Vec3{-local.x, 0.f, -local.z}) * (1.f / d);
        dir = towardAxis * (field.strength * (1.f - d / radius));
      } else {
        if (std::fabs(local.x) > field.halfExtents.x) continue;
        if (std::fabs(local.y) > field.halfExtents.y) continue;
        if (std::fabs(local.z) > field.halfExtents.z) continue;
        dir = (field.space == ForceSpace::Local)
            ? field.rotation.rotate(field.force)
            : field.force;
      }
      // A ball that has gone to sleep inside a conveyor or updraft must be
      // roused, or the field would silently stop acting on it.
      if (!body.isActive() && dir.lengthSq() > 1e-12f) body.wake();
      body.applyForce(field.acceleration ? dir * mass : dir);
    }
  }
}

} // namespace pachinball
