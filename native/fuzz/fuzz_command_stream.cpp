/**
 * libFuzzer target: a stream of world commands (#520 §5).
 *
 * The worker client's recovery log (src/wasm/physics-command-log.ts) is a
 * list of PhysicsWorkerCommand records replayed into a fresh engine. Each
 * opcode below is one of those command types, decoded from the input bytes
 * and applied to the PhysicsWorld it maps to (physics-worker-runtime.ts).
 * Arguments are table-scale, as the game sends them; the entry points that
 * sanitise their input (Boundary.h, #520 row 10) are also fed non-finite and
 * arbitrary float bit patterns.
 *
 * Invariants (each aborts, so libFuzzer keeps the input):
 *   - at every serializeSnapshot the world restores its own blob and
 *     re-serialises it to the same bytes: whatever a command stored, restore()
 *     accepts (#520 row 8 must never refuse a healthy world);
 *   - a refused restoreSnapshot leaves the world byte-for-byte as it was;
 *   - the same stream replayed into a second world ends in the same bytes and
 *     state hash (the recovery log's whole premise).
 */

#include "fuzz_common.hpp"

#include <algorithm>

using namespace pachinball;
using namespace pachinball::fuzz;

namespace {

/** Opcodes, one per PhysicsWorkerCommand type. scripts/run-fuzzers.mjs writes seeds with these values. */
enum Op : uint8_t {
  CreateBody = 0,
  CreateBoxBody,
  RemoveBody,
  ApplyForce,
  ApplyImpulse,
  SetVelocity,
  SetAngularVelocity,
  SetBodyPosition,
  SetBodyRotation,
  SetBodyType,
  CreateHinge,
  SetHingeMotor,
  RemoveHinge,
  AddStaticPlane,
  AddStaticBox,
  AddStaticCapsule,
  AddStaticCylinder,
  AddStaticSphere,
  AddStaticCone,
  AddPinField,
  AddStaticTriangleMesh,
  AddSensorVolume,
  AddKinematicMover,
  SetNextKinematicTransform,
  SetCollisionGroups,
  ClearStaticGeometry,
  AddForceField,
  SetForceFieldEnabled,
  SetForceFieldVector,
  SetGravity,
  SetRollingResistance,
  Step,
  SerializeSnapshot,
  RestoreSnapshot,
  GetStateHash,
  OpCount,
};

/** Keeps one input cheap: libFuzzer wants thousands of executions a second. */
constexpr int kMaxSteps = 48;
constexpr std::size_t kMaxBodies = 48;
constexpr std::size_t kMaxStatics = 192;

struct Ids {
  std::vector<int> bodies;
  std::vector<int> hinges;
  std::vector<int> movers;
  std::vector<int> fields;
  std::vector<int> statics;
  std::size_t staticCount = 0;
};

/** An id from `pool`, or (one in sixteen) an arbitrary one — dead, foreign or out of range. */
int pick(ByteReader& in, const std::vector<int>& pool) {
  const uint8_t b = in.u8();
  if (pool.empty() || (b & 15u) == 15u) return static_cast<int>(static_cast<int16_t>(in.u16()));
  return pool[static_cast<std::size_t>(b) % pool.size()];
}

Quat rawQuat(ByteReader& in) {
  return {in.raw(), in.raw(), in.raw(), in.raw()};
}

/** A rotation the game would send (normalised in JS), or (one in four) any bits. */
Quat rotation(ByteReader& in) {
  if ((in.u8() & 3u) == 0) return rawQuat(in);
  const Quat q{in.range(1.f), in.range(1.f), in.range(1.f), in.range(1.f)};
  return q.normalized();
}

Vec3 vec(ByteReader& in, float limit) {
  return {in.range(limit), in.range(limit), in.range(limit)};
}

RigidBodyDesc bodyDesc(ByteReader& in) {
  RigidBodyDesc d;
  d.position = vec(in, 6.f);
  d.velocity = vec(in, 12.f);
  d.mass = in.between(0.f, 2.f);
  d.radius = in.between(0.02f, 1.f);
  d.restitution = in.between(0.f, 1.f);
  d.linearDamping = in.between(0.f, 1.f);
  // Raw tags on purpose: createRigidBody must sanitise them (Boundary.h).
  d.type = static_cast<BodyType>(in.u8() % 5);
  d.shape = static_cast<Shape>(in.u8() % 5);
  d.capsuleHalfHeight = in.between(0.f, 1.f);
  d.friction = in.between(0.f, 1.f);
  d.angularDamping = in.between(0.f, 1.f);
  d.membership = in.flag() ? COLLISION_GROUPS_ALL : in.u32();
  d.filter = in.flag() ? COLLISION_GROUPS_ALL : in.u32();
  return d;
}

/** Run the whole stream on `w`; returns the final serialised bytes. */
std::vector<uint8_t> run(PhysicsWorld& w, const uint8_t* data, std::size_t size) {
  ByteReader in(data, size);
  Ids ids;
  std::vector<uint8_t> lastBlob;
  int steps = 0;

  auto addStatic = [&ids](int id) {
    ++ids.staticCount;
    if (id != STATIC_HANDLE_OVERFLOW) ids.statics.push_back(id);
  };

  // PACHINBALL_FUZZ_TRACE=1 ./fuzz_command_stream <crash-file>: the ops a finding ran.
  static const bool trace = std::getenv("PACHINBALL_FUZZ_TRACE") != nullptr;
  while (!in.done()) {
    const auto op = static_cast<Op>(in.u8() % OpCount);
    if (trace)
      std::fprintf(stderr, "op %d (bodies %zu, statics %zu)\n", static_cast<int>(op), ids.bodies.size(),
                   ids.staticCount);
    const bool staticsFull = ids.staticCount >= kMaxStatics;
    switch (op) {
      case CreateBody:
        if (ids.bodies.size() < kMaxBodies) ids.bodies.push_back(w.createRigidBody(bodyDesc(in)));
        break;
      case CreateBoxBody: {
        if (ids.bodies.size() >= kMaxBodies) break;
        RigidBodyDesc d = bodyDesc(in);
        d.shape = Shape::Box;
        d.boxHalfExtents = {in.between(0.05f, 1.f), in.between(0.05f, 1.f), in.between(0.05f, 1.f)};
        d.radius = d.boxHalfExtents.length();
        ids.bodies.push_back(w.createRigidBody(d));
        break;
      }
      case RemoveBody: {
        const int id = pick(in, ids.bodies);
        w.removeRigidBody(id);
        ids.bodies.erase(std::remove(ids.bodies.begin(), ids.bodies.end(), id), ids.bodies.end());
        break;
      }
      case ApplyForce: {
        const int id = pick(in, ids.bodies);
        const Vec3 f = vec(in, 40.f);
        w.applyForce(id, f.x, f.y, f.z);
        break;
      }
      case ApplyImpulse: {
        const int id = pick(in, ids.bodies);
        const Vec3 j = vec(in, 4.f);
        w.applyImpulse(id, j.x, j.y, j.z);
        break;
      }
      case SetVelocity: {
        const int id = pick(in, ids.bodies);
        const Vec3 v = vec(in, 20.f);
        w.setVelocity(id, v.x, v.y, v.z);
        break;
      }
      case SetAngularVelocity: {
        const int id = pick(in, ids.bodies);
        const Vec3 v = vec(in, 20.f);
        w.setAngularVelocity(id, v.x, v.y, v.z);
        break;
      }
      case SetBodyPosition: {
        const int id = pick(in, ids.bodies);
        const Vec3 p = vec(in, 6.f);
        w.setBodyPosition(id, p.x, p.y, p.z);
        break;
      }
      case SetBodyRotation: {
        const int id = pick(in, ids.bodies);
        const Quat q = rotation(in);
        w.setBodyRotation(id, q.x, q.y, q.z, q.w);
        break;
      }
      case SetBodyType: {
        const int id = pick(in, ids.bodies);
        w.setBodyType(id, static_cast<BodyType>(in.u8() % 4));
        break;
      }
      case CreateHinge: {
        HingeDesc h;
        const int body = pick(in, ids.bodies);
        h.worldAnchor = vec(in, 6.f);
        h.worldAxis = in.flag() ? Vec3{in.raw(), in.raw(), in.raw()} : vec(in, 1.f);
        h.minAngle = in.flag() ? in.raw() : in.range(3.f);
        h.maxAngle = in.flag() ? in.raw() : in.range(3.f);
        h.motorTargetVel = in.rangeOrNonFinite(20.f);
        h.motorMaxTorque = in.rangeOrNonFinite(200.f);
        h.baumgarte = in.rangeOrNonFinite(1.f);
        const int id = w.createHinge(body, h);
        if (id >= 0) ids.hinges.push_back(id);
        break;
      }
      case SetHingeMotor: {
        const int id = pick(in, ids.hinges);
        const float v = in.rangeOrNonFinite(20.f);
        w.setHingeMotor(id, v, in.rangeOrNonFinite(200.f));
        break;
      }
      case RemoveHinge: {
        const int id = pick(in, ids.hinges);
        w.removeHinge(id);
        break;
      }
      case AddStaticPlane: {
        if (staticsFull) break;
        const bool raw = in.flag();
        const Vec3 n = raw ? Vec3{in.raw(), in.raw(), in.raw()} : vec(in, 1.f);
        w.addStaticPlane(n.x, n.y, n.z, raw ? in.rangeOrNonFinite(4.f) : in.range(4.f), in.between(0.f, 1.f));
        ++ids.staticCount;
        break;
      }
      case AddStaticBox: {
        if (staticsFull) break;
        const Vec3 c = vec(in, 8.f);
        const Quat q = rotation(in);
        addStatic(w.addStaticBox(c.x, c.y, c.z, in.between(0.02f, 2.f), in.between(0.02f, 2.f), in.between(0.02f, 2.f),
                                 q.x, q.y, q.z, q.w, in.between(0.f, 1.f), in.between(0.f, 1.f)));
        break;
      }
      case AddStaticCapsule:
      case AddStaticCylinder:
      case AddStaticCone: {
        if (staticsFull) break;
        const Vec3 c = vec(in, 8.f);
        const Quat q = rotation(in);
        const float r = in.between(0.02f, 1.f), hh = in.between(0.f, 1.f);
        const float e = in.between(0.f, 1.f), mu = in.between(0.f, 1.f);
        if (op == AddStaticCapsule)
          addStatic(w.addStaticCapsule(c.x, c.y, c.z, r, hh, q.x, q.y, q.z, q.w, e, mu));
        else if (op == AddStaticCylinder)
          addStatic(w.addStaticCylinder(c.x, c.y, c.z, r, hh, q.x, q.y, q.z, q.w, e, mu));
        else
          addStatic(w.addStaticCone(c.x, c.y, c.z, r, hh, q.x, q.y, q.z, q.w, e, mu));
        break;
      }
      case AddStaticSphere: {
        if (staticsFull) break;
        const Vec3 c = vec(in, 8.f);
        addStatic(w.addStaticSphere(c.x, c.y, c.z, in.between(0.02f, 1.f), in.between(0.f, 1.f), in.between(0.f, 1.f)));
        break;
      }
      case AddPinField: {
        if (staticsFull) break;
        PinFieldDesc p;
        p.origin = vec(in, 6.f);
        p.rows = in.u8() % 8;
        p.cols = in.u8() % 8;
        p.spacingX = in.between(0.05f, 1.f);
        p.spacingZ = in.between(0.05f, 1.f);
        p.rowOffsetX = in.range(0.5f);
        p.radius = in.between(0.01f, 0.3f);
        p.halfHeight = in.between(0.f, 0.5f);
        p.rotation = rotation(in);
        p.dropoutSeed = in.u32();
        p.dropout = in.between(0.f, 1.f);
        for (uint8_t k = in.u8() % 3; k > 0; --k) {
          p.keepOuts.push_back({in.range(3.f), in.range(3.f), in.range(3.f), in.range(3.f)});
        }
        if (in.flag()) {
          for (uint8_t k = in.u8() % 9; k > 0; --k) p.occupancy.push_back(in.u8());
        }
        addStatic(w.addPinField(p));
        break;
      }
      case AddStaticTriangleMesh: {
        if (staticsFull) break;
        std::vector<float> vertices;
        std::vector<uint32_t> indices;
        const int vertexCount = in.u8() % 10;
        vertices.reserve(static_cast<std::size_t>(vertexCount) * 3);
        for (int k = 0; k < vertexCount * 3; ++k) vertices.push_back(in.range(6.f));
        // Indices may point past the vertices: addStaticTriangleMesh must cope.
        for (int k = in.u8() % 16; k > 0; --k) indices.push_back(in.u8() % 12);
        addStatic(w.addStaticTriangleMesh(vertices.data(), vertexCount, indices.data(),
                                          static_cast<int>(indices.size()), in.between(0.f, 1.f), in.between(0.f, 1.f),
                                          in.flag()));
        break;
      }
      case AddSensorVolume: {
        if (staticsFull) break;
        SensorVolumeDesc s;
        s.center = vec(in, 8.f);
        s.halfExtents = {in.between(0.02f, 2.f), in.between(0.02f, 2.f), in.between(0.02f, 2.f)};
        s.rotation = rotation(in);
        s.shape = static_cast<VolumeShape>(in.u8() % 5);
        addStatic(w.addSensorVolume(s));
        break;
      }
      case AddKinematicMover: {
        if (staticsFull) break;
        KinematicMoverDesc m;
        m.position = vec(in, 8.f);
        m.halfExtents = {in.between(0.02f, 2.f), in.between(0.02f, 2.f), in.between(0.02f, 2.f)};
        m.rotation = rotation(in);
        m.shape = static_cast<VolumeShape>(in.u8() % 5);
        m.restitution = in.between(0.f, 1.f);
        m.friction = in.between(0.f, 1.f);
        const int id = w.addKinematicMover(m);
        ++ids.staticCount;
        if (id != STATIC_HANDLE_OVERFLOW) {
          ids.movers.push_back(id);
          ids.statics.push_back(id);
        }
        break;
      }
      case SetNextKinematicTransform: {
        const int id = in.flag() ? pick(in, ids.movers) : pick(in, ids.bodies);
        const Vec3 p{in.rangeOrNonFinite(8.f), in.rangeOrNonFinite(8.f), in.rangeOrNonFinite(8.f)};
        const Quat q = rotation(in);
        w.setNextKinematicTransform(id, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
        break;
      }
      case SetCollisionGroups: {
        const int id = in.flag() ? pick(in, ids.statics) : pick(in, ids.bodies);
        w.setCollisionGroups(id, in.u32(), in.u32());
        break;
      }
      case ClearStaticGeometry:
        w.clearStaticGeometry();
        ids.movers.clear();
        ids.fields.clear();
        ids.statics.clear();
        ids.staticCount = 0;
        break;
      case AddForceField: {
        if (staticsFull) break;
        ForceFieldDesc f;
        f.center = vec(in, 8.f);
        f.halfExtents = {in.between(0.05f, 3.f), in.between(0.05f, 3.f), in.between(0.05f, 3.f)};
        f.rotation = rotation(in);
        f.force = {in.rangeOrNonFinite(20.f), in.rangeOrNonFinite(20.f), in.rangeOrNonFinite(20.f)};
        f.space = static_cast<ForceSpace>(in.u8() % 4);
        f.acceleration = in.flag();
        f.mode = static_cast<ForceMode>(in.u8() % 4);
        f.strength = in.range(20.f);
        const int id = w.addForceField(f);
        ++ids.staticCount;
        if (id != STATIC_HANDLE_OVERFLOW) {
          ids.fields.push_back(id);
          ids.statics.push_back(id);
        }
        break;
      }
      case SetForceFieldEnabled: {
        const int id = pick(in, ids.fields);
        w.setForceFieldEnabled(id, in.flag());
        break;
      }
      case SetForceFieldVector: {
        const int id = pick(in, ids.fields);
        w.setForceFieldVector(id, in.rangeOrNonFinite(20.f), in.rangeOrNonFinite(20.f), in.rangeOrNonFinite(20.f));
        break;
      }
      case SetGravity:
        w.setGravity(in.rangeOrNonFinite(15.f), in.rangeOrNonFinite(15.f), in.rangeOrNonFinite(15.f));
        break;
      case SetRollingResistance: w.setRollingResistance(in.rangeOrNonFinite(0.2f)); break;
      case Step: {
        if (steps >= kMaxSteps) break;
        ++steps;
        const uint8_t kind = in.u8();
        // Mostly the one fixed tick the game sends; sometimes any float.
        w.step((kind & 3u) == 0 ? in.raw() : FIXED_DT * static_cast<float>(1 + (kind >> 6)));
        break;
      }
      case SerializeSnapshot: {
        lastBlob = w.serialize();
        if (w.restore(lastBlob.data(), lastBlob.size()) != SnapshotStatus::Ok) {
          fail("a world refuses its own snapshot");
        }
        if (w.serialize() != lastBlob) fail("serialize -> restore -> serialize is not the identity");
        break;
      }
      case RestoreSnapshot: {
        if (lastBlob.empty()) break;
        std::vector<uint8_t> blob = lastBlob;
        // Flip up to two bytes: a corrupted checkpoint must be refused cleanly.
        for (uint8_t k = in.u8() % 3; k > 0; --k) blob[in.u16() % blob.size()] ^= in.u8();
        // An accepted one replaces bodies and hinges wholesale; ids left in the
        // pools that no longer exist are no-ops, as they are for the game.
        const std::vector<uint8_t> before = w.serialize();
        if (w.restore(blob.data(), blob.size()) != SnapshotStatus::Ok && w.serialize() != before) {
          fail("refused restore changed the world");
        }
        break;
      }
      case GetStateHash: (void)w.getStateHash(); break;
      case OpCount: break;
    }
  }
  return w.serialize();
}

} // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, std::size_t size) {
  PhysicsWorld a;
  const std::vector<uint8_t> endA = run(a, data, size);
  PhysicsWorld b;
  const std::vector<uint8_t> endB = run(b, data, size);
  if (endA != endB) fail("the same command stream ended in different snapshots");
  if (a.getStateHash() != b.getStateHash()) fail("the same command stream ended in different state hashes");
  return 0;
}
