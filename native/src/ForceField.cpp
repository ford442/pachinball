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

int PhysicsWorld::addForceField(const ForceFieldDesc& desc) {
  fields_.push_back(desc);
  return FORCE_FIELD_ID_BASE - (static_cast<int>(fields_.size()) - 1);
}

void PhysicsWorld::setForceFieldEnabled(int fieldId, bool enabled) {
  const std::size_t idx = static_cast<std::size_t>(FORCE_FIELD_ID_BASE - fieldId);
  if (idx >= fields_.size()) return;
  fields_[idx].enabled = enabled;
}

void PhysicsWorld::setForceFieldVector(int fieldId, float fx, float fy, float fz) {
  const std::size_t idx = static_cast<std::size_t>(FORCE_FIELD_ID_BASE - fieldId);
  if (idx >= fields_.size()) return;
  fields_[idx].force = {fx, fy, fz};
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
      if (std::fabs(local.x) > field.halfExtents.x) continue;
      if (std::fabs(local.y) > field.halfExtents.y) continue;
      if (std::fabs(local.z) > field.halfExtents.z) continue;

      const Vec3 dir = (field.space == ForceSpace::Local)
                     ? field.rotation.rotate(field.force)
                     : field.force;
      // A ball that has gone to sleep inside a conveyor or updraft must be
      // roused, or the field would silently stop acting on it.
      if (!body.isActive() && dir.lengthSq() > 1e-12f) body.wake();
      body.applyForce(field.acceleration ? dir * mass : dir);
    }
  }
}

} // namespace pachinball
