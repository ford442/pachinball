/**
 * Pin fields (#421): a whole pachinko lattice as one static collider.
 *
 * Construction resolves the lattice once (occupancy mask, keep-outs, seeded
 * dropout) into a byte-per-slot `present` table plus a world AABB. Per
 * substep the broadphase half (`appendPinFieldPairs`) is one AABB test per
 * (awake sphere, field), and the narrowphase turns the ball's field-local
 * position into a row/column index range — O(1) candidates however large the
 * field is — then runs the exact `resolveSphereVsCylinder` an equivalent
 * `addStaticCylinder` per pin would, so the two stay contact-for-contact
 * interchangeable (scripts/run-wasm-parity.mjs holds them to that).
 *
 * All PhysicsWorld methods here are declared in PhysicsWorld.h.
 */
#include "PinField.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

uint32_t pinFieldHash(uint32_t seed, uint32_t index) {
  // lowbias32 finalizer over (seed ^ golden-ratio-scrambled index).
  uint32_t h = seed ^ (index * 0x9E3779B9u);
  h ^= h >> 16;
  h *= 0x7FEB352Du;
  h ^= h >> 15;
  h *= 0x846CA68Bu;
  h ^= h >> 16;
  return h;
}

bool pinFieldDropped(uint32_t seed, float dropout, uint32_t index) {
  if (!(dropout > 0.f)) return false;
  const double p = dropout >= 1.f ? 1.0 : static_cast<double>(dropout);
  const uint32_t threshold = static_cast<uint32_t>(p * 16777216.0);
  return (pinFieldHash(seed, index) >> 8) < threshold;
}

namespace {

bool inKeepOut(const std::vector<PinKeepOut>& keepOuts, const Vec3& p) {
  for (const PinKeepOut& k : keepOuts) {
    if (p.x >= k.minX && p.x <= k.maxX && p.z >= k.minZ && p.z <= k.maxZ) return true;
  }
  return false;
}

bool maskAllows(const std::vector<uint8_t>& mask, std::size_t index) {
  if (mask.empty()) return true;
  const std::size_t byte = index >> 3;
  if (byte >= mask.size()) return false;
  return (mask[byte] >> (index & 7u)) & 1u;
}

/** Clamp before the int cast so a ball far off the table cannot overflow it. */
int clampIndex(float v, int hi) {
  if (!(v > 0.f)) return 0;
  if (v > static_cast<float>(hi)) return hi;
  return static_cast<int>(v);
}

} // namespace

PinField buildPinField(const PinFieldDesc& desc) {
  PinField field;
  field.desc = desc;
  field.desc.rows = std::max(0, desc.rows);
  field.desc.cols = std::max(0, desc.cols);
  field.desc.spacingX = std::max(desc.spacingX, 1e-4f);
  field.desc.spacingZ = std::max(desc.spacingZ, 1e-4f);
  field.desc.rotation = desc.rotation.normalized();
  field.invRotation = field.desc.rotation.conjugate();

  const int rows = field.desc.rows;
  const int cols = field.desc.cols;
  field.present.assign(static_cast<std::size_t>(rows) * static_cast<std::size_t>(cols), 0);

  // Every pin shares one orientation, so one extent vector bounds them all
  // (the exact rotated-cylinder AABB, as BroadphaseGrid::cellsForCylinder).
  const Vec3 axis = field.desc.rotation.rotate(Vec3::up());
  auto extent = [&](float ae) {
    const float perp = std::sqrt(std::max(0.f, 1.f - ae * ae));
    return std::fabs(field.desc.halfHeight * ae) + field.desc.radius * perp;
  };
  const Vec3 ext{extent(axis.x), extent(axis.y), extent(axis.z)};

  Vec3 lo{1e30f, 1e30f, 1e30f};
  Vec3 hi{-1e30f, -1e30f, -1e30f};
  for (int r = 0; r < rows; ++r) {
    for (int c = 0; c < cols; ++c) {
      const std::size_t idx = static_cast<std::size_t>(r) * static_cast<std::size_t>(cols) +
                              static_cast<std::size_t>(c);
      if (!maskAllows(field.desc.occupancy, idx)) continue;
      const Vec3 p = field.worldPin(r, c);
      if (inKeepOut(field.desc.keepOuts, p)) continue;
      if (pinFieldDropped(field.desc.dropoutSeed, field.desc.dropout, static_cast<uint32_t>(idx))) continue;
      field.present[idx] = 1;
      ++field.pinCount;
      lo = {std::min(lo.x, p.x - ext.x), std::min(lo.y, p.y - ext.y), std::min(lo.z, p.z - ext.z)};
      hi = {std::max(hi.x, p.x + ext.x), std::max(hi.y, p.y + ext.y), std::max(hi.z, p.z + ext.z)};
    }
  }
  field.aabbMin = lo;
  field.aabbMax = hi;
  return field;
}

bool pinFieldRowRange(const PinField& field, const Vec3& local, float reach, int& r0, int& r1) {
  const PinFieldDesc& d = field.desc;
  if (d.rows <= 0 || d.cols <= 0) return false;
  if (std::fabs(local.y) > d.halfHeight + reach) return false;
  const float lastZ = static_cast<float>(d.rows - 1) * d.spacingZ;
  if (local.z + reach < 0.f || local.z - reach > lastZ) return false;
  r0 = clampIndex(std::ceil((local.z - reach) / d.spacingZ), d.rows - 1);
  r1 = clampIndex(std::floor((local.z + reach) / d.spacingZ), d.rows - 1);
  return r0 <= r1;
}

void pinFieldColumnRange(const PinField& field, int row, float localX, float reach, int& c0, int& c1) {
  const PinFieldDesc& d = field.desc;
  const float x = localX - ((row & 1) ? d.rowOffsetX : 0.f);
  const float lastX = static_cast<float>(d.cols - 1) * d.spacingX;
  if (x + reach < 0.f || x - reach > lastX) {
    c0 = 1;
    c1 = 0;
    return;
  }
  c0 = clampIndex(std::ceil((x - reach) / d.spacingX), d.cols - 1);
  c1 = clampIndex(std::floor((x + reach) / d.spacingX), d.cols - 1);
}

int PhysicsWorld::addPinField(const PinFieldDesc& desc) {
  if (pinFields_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  pinFields_.push_back(buildPinField(desc));
  return PIN_FIELD_ID_BASE - (static_cast<int>(pinFields_.size()) - 1);
}

int PhysicsWorld::getPinFieldPinCount(int fieldId) const {
  const std::size_t idx = static_cast<std::size_t>(PIN_FIELD_ID_BASE - fieldId);
  if (fieldId > PIN_FIELD_ID_BASE || idx >= pinFields_.size()) return -1;
  return pinFields_[idx].pinCount;
}

void PhysicsWorld::appendPinFieldPairs() {
  if (pinFields_.empty()) return;
  for (int i = 0; i < bodies_.denseCount(); ++i) {
    if (!bodies_.isAwake(i)) continue;
    // Only spheres meet static cylinders (the cylinder dispatch rule), so
    // only spheres are worth a pin-field pair.
    if (static_cast<Shape>(bodies_.shape(i)) != Shape::Sphere) continue;
    if (static_cast<BodyType>(bodies_.type(i)) != BodyType::Dynamic) continue;
    const float r = bodies_.radius(i);
    const float px = bodies_.posX(i);
    const float py = bodies_.posY(i);
    const float pz = bodies_.posZ(i);
    for (std::size_t f = 0; f < pinFields_.size(); ++f) {
      const PinField& field = pinFields_[f];
      if (field.pinCount == 0) continue;
      if (px + r < field.aabbMin.x || px - r > field.aabbMax.x) continue;
      if (py + r < field.aabbMin.y || py - r > field.aabbMax.y) continue;
      if (pz + r < field.aabbMin.z || pz - r > field.aabbMax.z) continue;
      if (!groupsInteract(bodies_.membership(i), bodies_.filter(i),
                          field.desc.membership, field.desc.filter)) continue;
      pairs_.push_back({BroadphaseGrid::Pair::BodyPinField, i, static_cast<int>(f)});
    }
  }
}

void PhysicsWorld::resolveSphereVsPinField(BodyView& body, int fieldIndex) {
  const PinField& field = pinFields_[static_cast<std::size_t>(fieldIndex)];
  const PinFieldDesc& d = field.desc;
  const float reach = body.getRadius() + d.radius;
  const Vec3 local = field.invRotation.rotate(body.getPosition() - d.origin);

  int r0 = 0;
  int r1 = -1;
  if (!pinFieldRowRange(field, local, reach, r0, r1)) return;

  CylinderDesc pin;
  pin.radius = d.radius;
  pin.halfHeight = d.halfHeight;
  pin.rotation = d.rotation;
  pin.restitution = d.restitution;
  pin.friction = d.friction;
  pin.membership = d.membership;
  pin.filter = d.filter;
  const int fieldId = PIN_FIELD_ID_BASE - fieldIndex;

  for (int r = r0; r <= r1; ++r) {
    int c0 = 0;
    int c1 = -1;
    pinFieldColumnRange(field, r, local.x, reach, c0, c1);
    for (int c = c0; c <= c1; ++c) {
      const int idx = r * d.cols + c;
      if (!field.present[static_cast<std::size_t>(idx)]) continue;
      pin.center = field.worldPin(r, c);
      resolveSphereVsCylinder(body, pin, fieldId, idx);
    }
  }
}

} // namespace pachinball
