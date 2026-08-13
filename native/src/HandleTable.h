#pragma once

#include <cstdint>
#include <vector>

namespace pachinball {

/**
 * O(1) public-id → dense-index lookup with generation validation.
 * Public ids are monotonic and never reused (wasm-owner depends on this).
 */
class HandleTable {
public:
  struct Slot {
    int      denseIndex = -1;
    uint16_t generation = 0;
  };

  /** Allocate a new public id (does not bind a dense index yet). */
  int allocateId() {
    const int id = nextId_++;
    if (static_cast<std::size_t>(id) >= slots_.size()) {
      slots_.resize(static_cast<std::size_t>(id) + 1);
    }
    return id;
  }

  void bind(int id, int denseIndex) {
    slots_[static_cast<std::size_t>(id)].denseIndex = denseIndex;
  }

  void kill(int id) {
    auto& slot = slots_[static_cast<std::size_t>(id)];
    slot.denseIndex = -1;
    ++slot.generation;
  }

  /** @returns dense index, or -1 if id is dead / invalid. */
  int findDenseIndex(int id) const {
    if (id < 0 || static_cast<std::size_t>(id) >= slots_.size()) return -1;
    const Slot& slot = slots_[static_cast<std::size_t>(id)];
    return slot.denseIndex;
  }

  uint16_t generation(int id) const {
    if (id < 0 || static_cast<std::size_t>(id) >= slots_.size()) return 0;
    return slots_[static_cast<std::size_t>(id)].generation;
  }

  int nextId() const { return nextId_; }
  int slotCount() const { return nextId_; }

private:
  std::vector<Slot> slots_;
  int nextId_ = 0;
};

} // namespace pachinball
