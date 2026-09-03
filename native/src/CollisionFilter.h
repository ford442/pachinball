#pragma once

#include <cstdint>

namespace pachinball {

/**
 * Collision-group membership/filter bitmasks.
 *
 * Mirrors `CollisionGroups` in src/game-elements/physics.ts exactly — do not
 * renumber independently of that file. Two colliders interact iff each one's
 * membership intersects the other's filter (symmetric AND, matching Rapier's
 * InteractionGroups semantics).
 *
 * Default membership/filter is all-bits-set so a body created without an
 * explicit mask collides with everything, preserving pre-filter behavior.
 */
enum CollisionGroup : uint32_t {
  GROUP_BALL      = 0x0001,
  GROUP_WALL      = 0x0002,
  GROUP_BUMPER    = 0x0004,
  GROUP_SENSOR    = 0x0008,
  GROUP_FLIPPER   = 0x0010,
  GROUP_TARGET    = 0x0020,
  GROUP_SPINNER   = 0x0040,
  GROUP_GATE      = 0x0080,
  GROUP_ADVENTURE = 0x0100,
};

inline constexpr uint32_t COLLISION_GROUPS_ALL = 0xFFFFFFFFu;

/** Symmetric membership/filter interaction test (matches Rapier InteractionGroups). */
inline bool groupsInteract(uint32_t membershipA, uint32_t filterA,
                           uint32_t membershipB, uint32_t filterB) {
  return (membershipA & filterB) != 0u && (membershipB & filterA) != 0u;
}

} // namespace pachinball
