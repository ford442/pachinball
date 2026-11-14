/**
 * Collision groups (and gravity) shared by every table builder, the C++ export and the headless replay runner.
 * Dependency-free (no Rapier, no Babylon): `game-elements/physics.ts` re-exports these.
 */

// Gravity: -Y (down), -Z (roll towards player). Shared by the game's PhysicsSystem and the headless replay world.
export const GRAVITY = { x: 0, y: -9.81, z: -5.0 }

export const CollisionGroups = {
  BALL:    0x0001,
  WALL:    0x0002,
  BUMPER:  0x0004,
  SENSOR:  0x0008,
  FLIPPER: 0x0010,
  TARGET:  0x0020,
  SPINNER: 0x0040,
  GATE:    0x0080,
  ADVENTURE: 0x0100,
} as const

export const ADVENTURE_GROUP = CollisionGroups.ADVENTURE

/**
 * Create a Rapier collision group bitmask.
 * @param membership - Which groups this collider belongs to
 * @param filter - Which groups this collider can interact with
 * @returns Combined 32-bit collision group value for Rapier
 */
export function makeCollisionGroups(membership: number, filter: number): number {
  return ((membership & 0xFFFF) << 16) | (filter & 0xFFFF)
}

/** Pre-built collision group values for common object types */
export const COLLISION_GROUP_PRESETS = {
  /** Ball collides with walls, bumpers, sensors, flippers, targets, spinners, gates */
  BALL: makeCollisionGroups(
    CollisionGroups.BALL,
    CollisionGroups.WALL | CollisionGroups.BUMPER | CollisionGroups.SENSOR |
    CollisionGroups.FLIPPER | CollisionGroups.TARGET | CollisionGroups.SPINNER |
    CollisionGroups.GATE | CollisionGroups.ADVENTURE
  ),
  /** Walls only collide with balls */
  WALL: makeCollisionGroups(CollisionGroups.WALL, CollisionGroups.BALL),
  /** Bumpers only collide with balls */
  BUMPER: makeCollisionGroups(CollisionGroups.BUMPER, CollisionGroups.BALL),
  /** Sensors only collide with balls */
  SENSOR: makeCollisionGroups(CollisionGroups.SENSOR, CollisionGroups.BALL),
  /** Flippers only collide with balls */
  FLIPPER: makeCollisionGroups(CollisionGroups.FLIPPER, CollisionGroups.BALL),
  /** Targets only collide with balls */
  TARGET: makeCollisionGroups(CollisionGroups.TARGET, CollisionGroups.BALL),
  /** Spinners only collide with balls */
  SPINNER: makeCollisionGroups(CollisionGroups.SPINNER, CollisionGroups.BALL),
  /** Gates only collide with balls */
  GATE: makeCollisionGroups(CollisionGroups.GATE, CollisionGroups.BALL),
  /** Adventure track bodies only collide with balls */
  ADVENTURE: makeCollisionGroups(ADVENTURE_GROUP, CollisionGroups.BALL),
} as const
