/**
 * libFuzzer target: `PhysicsWorld::restore()` on untrusted bytes (#520 §5).
 *
 * The replay verifier restores a submitted tape's frame-0 snapshot, so every
 * byte of a blob is attacker-controlled. Per input:
 *
 *   1. restore into an empty world (header / truncation paths);
 *   2. build a table with the blob's own per-family static counts and patch
 *      the blob's static hash to that table's, so a real tape (the corpus is
 *      their frame-0 snapshots) decodes all the way through;
 *   3. restore into a world that has already stepped, then 8 steps, then hash.
 *
 * Invariants (each aborts, so libFuzzer keeps the input):
 *   - a refused restore leaves the world byte-for-byte as it was;
 *   - an accepted blob's world restores its own snapshot, and re-serialises
 *     to the same bytes (restore validated everything it committed);
 *   - a fresh world restoring the same blob steps to the same state hash as
 *     the one with history: nothing outside the snapshot steers the step.
 * Plus everything ASan / UBSan / the libFuzzer timeout catch on the way.
 */

#include "fuzz_common.hpp"

using namespace pachinball;
using namespace pachinball::fuzz;

namespace {

constexpr int kSteps = 8;

/** Unrelated history for the first world: a ball dropped onto the table and stepped. */
void stepUnrelatedHistory(PhysicsWorld& w) {
  RigidBodyDesc ball;
  ball.position = {0.3f, 1.f, 0.2f};
  ball.velocity = {0.5f, 0.f, -1.f};
  ball.radius = 0.2f;
  w.createRigidBody(ball);
  for (int i = 0; i < 3; ++i) w.step(FIXED_DT);
}

} // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, std::size_t size) {
  std::vector<uint8_t> blob(data, data + size);

  {
    PhysicsWorld empty;
    const std::vector<uint8_t> before = empty.serialize();
    if (empty.restore(blob.data(), blob.size()) != SnapshotStatus::Ok && empty.serialize() != before) {
      fail("refused restore changed an empty world");
    }
  }

  if (size < static_cast<std::size_t>(SNAPSHOT_HEADER_WORDS) * 4) return 0;
  uint32_t counts[SNAPSHOT_STATIC_FAMILIES];
  for (int f = 0; f < SNAPSHOT_STATIC_FAMILIES; ++f) counts[f] = readWordLE(blob, 5 + static_cast<std::size_t>(f));

  PhysicsWorld world;
  if (!buildTableWithCounts(world, counts)) return 0;
  const uint64_t staticHash = world.staticContentHash();
  writeWordLE(blob, 3, static_cast<uint32_t>(staticHash));
  writeWordLE(blob, 4, static_cast<uint32_t>(staticHash >> 32));

  stepUnrelatedHistory(world);
  const std::vector<uint8_t> before = world.serialize();
  if (world.restore(blob.data(), blob.size()) != SnapshotStatus::Ok) {
    if (world.serialize() != before) fail("refused restore changed the world");
    return 0;
  }

  const std::vector<uint8_t> own = world.serialize();
  if (world.restore(own.data(), own.size()) != SnapshotStatus::Ok) fail("a restored world refuses its own snapshot");
  if (world.serialize() != own) fail("serialize -> restore -> serialize is not the identity");

  PhysicsWorld fresh;
  buildTableWithCounts(fresh, counts);
  if (fresh.restore(blob.data(), blob.size()) != SnapshotStatus::Ok) {
    fail("a fresh table refused a blob the stepped one accepted");
  }
  if (fresh.getStateHash() != world.getStateHash()) fail("restored state hash depends on the world's history");

  for (int i = 0; i < kSteps; ++i) {
    world.step(FIXED_DT);
    fresh.step(FIXED_DT);
  }
  if (fresh.getStateHash() != world.getStateHash()) fail("stepping a restored world depends on its history");
  return 0;
}
