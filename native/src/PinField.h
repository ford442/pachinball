#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"

#include <cstdint>
#include <vector>

namespace pachinball {

/**
 * World-space XZ keep-out rectangle (launch lane, flipper arcs, catcher).
 * Inclusive on every edge, like `KEEP_OUT_BOXES` in daily-cascade-layout.ts:
 * a pin whose centre lies on the boundary is omitted.
 */
struct PinKeepOut {
  float minX = 0.f;
  float maxX = 0.f;
  float minZ = 0.f;
  float maxZ = 0.f;
};

/**
 * A whole pachinko pin lattice as ONE static collider (#421).
 *
 * Pin (row r, col c) sits at local (c * spacingX + (r odd ? rowOffsetX : 0),
 * 0, r * spacingZ), rotated by `rotation` and translated by `origin` — so
 * `origin` is the centre of pin (0, 0). Every pin is the same oriented
 * cylinder (local Y axis, `radius`, `halfHeight`), exactly the collider
 * `addStaticCylinder` would build for it.
 *
 * A lattice slot holds a pin unless one of these removes it:
 *   - `occupancy` is non-empty and bit (r * cols + c) is clear (LSB-first
 *     bytes; a mask shorter than the lattice clears the missing slots);
 *   - the pin centre's world XZ falls inside a `keepOuts` rectangle;
 *   - `dropout` > 0 and the seeded hash `pinFieldDropped(seed, index)` fires.
 * TypeScript mirrors all three rules in src/core/pin-field.ts so the visual
 * instances land exactly on the pins C++ collides with.
 */
struct PinFieldDesc {
  Vec3     origin      = Vec3::zero();
  int      rows        = 0;
  int      cols        = 0;
  float    spacingX    = 1.f;
  float    spacingZ    = 1.f;
  /** Local +X shift of odd rows (the staggered pachinko lattice). */
  float    rowOffsetX  = 0.f;
  float    radius      = 0.1f;
  float    halfHeight  = 0.5f;
  Quat     rotation    = Quat::identity();
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
  std::vector<PinKeepOut> keepOuts;
  /** Bit-packed occupancy, LSB-first; empty means every slot is occupied. */
  std::vector<uint8_t>    occupancy;
  uint32_t dropoutSeed = 0;
  /** Probability in [0, 1] that the seeded hash removes a slot. */
  float    dropout     = 0.f;
};

/** A field as the world stores it: the descriptor plus its resolved lattice. */
struct PinField {
  PinFieldDesc desc;
  /** One byte per lattice slot (row-major): 1 = a pin is there. */
  std::vector<uint8_t> present;
  int  pinCount = 0;
  Quat invRotation = Quat::identity();
  /** World AABB of every present pin, empty (min > max) when `pinCount == 0`. */
  Vec3 aabbMin = Vec3::zero();
  Vec3 aabbMax = Vec3::zero();

  /** Local-frame centre of lattice slot (row, col). */
  Vec3 localPin(int row, int col) const {
    return {static_cast<float>(col) * desc.spacingX + ((row & 1) ? desc.rowOffsetX : 0.f),
            0.f,
            static_cast<float>(row) * desc.spacingZ};
  }
  Vec3 worldPin(int row, int col) const {
    return desc.origin + desc.rotation.rotate(localPin(row, col));
  }
};

/**
 * Seeded per-slot dropout shared bit-for-bit with src/core/pin-field.ts: a
 * 32-bit integer hash of (seed, lattice index), compared in 24-bit fixed
 * point so both sides agree without trusting float rounding.
 */
uint32_t pinFieldHash(uint32_t seed, uint32_t index);
bool pinFieldDropped(uint32_t seed, float dropout, uint32_t index);

/** Resolve occupancy / keep-outs / dropout and the world AABB. */
PinField buildPinField(const PinFieldDesc& desc);

/**
 * Candidate lattice ranges for a sphere of `reach` (ball radius + pin radius)
 * centred at `local` (field frame): rows [r0, r1] and, per row, cols from
 * `pinFieldColumnRange`. O(1) — never O(rows * cols). Returns false when the
 * sphere cannot touch any pin (outside the lattice or the pin height).
 */
bool pinFieldRowRange(const PinField& field, const Vec3& local, float reach, int& r0, int& r1);
void pinFieldColumnRange(const PinField& field, int row, float localX, float reach, int& c0, int& c1);

/** Negative-id base for pin fields: one slot per field, not per pin. */
static constexpr int PIN_FIELD_ID_BASE = -10000;

} // namespace pachinball
