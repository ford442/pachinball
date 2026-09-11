#pragma once

#include "MathTypes.h"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <new>
#include <unordered_map>
#include <vector>

namespace pachinball {

/** Contact lifecycle relative to the previous physics `step()`. */
enum class ContactPhase : int {
  Enter = 0, ///< Pair was absent last step, present now
  Stay  = 1, ///< Pair present in both steps (one event, peak impulse)
  Exit  = 2, ///< Pair was present last step, absent now
};

/** Packed contact-buffer layout: 12 floats, 48 bytes (16-byte aligned). */
inline constexpr int CONTACT_STRIDE = 12;

/** Default hard cap — well past a 130-pin field + multiball, still bounded. */
inline constexpr std::size_t CONTACT_DEFAULT_MAX = 65536;

/** A contact event between two rigid bodies. */
struct ContactEvent {
  int           bodyId1    = -1;      ///< ID of the first body
  int           bodyId2    = -1;      ///< ID of the second body
  Vec3          point;                ///< World-space contact point
  Vec3          normal;               ///< Contact normal (pointing from body2 to body1)
  float         impulse    = 0.f;     ///< Peak impulse magnitude observed this step
  ContactPhase  phase      = ContactPhase::Enter;
  bool          isSensor   = false;   ///< True for sensor-volume overlaps: no impulse/correction applied
  bool          isEntering() const { return phase == ContactPhase::Enter; }
};

/** Callback signature for contact events. */
using ContactCallback = std::function<void(const ContactEvent&)>;

inline uint64_t contactPairKey(int a, int b) {
  const int lo = (a <= b) ? a : b;
  const int hi = (a <= b) ? b : a;
  return (static_cast<uint64_t>(static_cast<uint32_t>(lo)) << 32) |
          static_cast<uint32_t>(hi);
}

/**
 * ContactListener — persistent contact manifold + packed emit buffer.
 *
 * Resolvers call pushContact() during every substep. At the end of PhysicsWorld::step()
 * (after all substeps), flushEvents() classifies each ordered (bodyIdA, bodyIdB) pair:
 *   - absent last step, present now → Enter
 *   - present both                  → Stay (peak impulse across substeps; one emit)
 *   - present last step, absent now → Exit
 *
 * Exactly one event is written per pair per step into a growable, 16-byte-aligned
 * float buffer that JS reads as a single Float32Array view.
 */
class ContactListener {
public:
  ContactListener() = default;
  ContactListener(const ContactListener&) = delete;
  ContactListener& operator=(const ContactListener&) = delete;

  ContactListener(ContactListener&& other) noexcept { moveFrom(other); }
  ContactListener& operator=(ContactListener&& other) noexcept {
    if (this != &other) {
      freeBuffer();
      moveFrom(other);
    }
    return *this;
  }

  ~ContactListener() { freeBuffer(); }

  /** Register (or replace) the contact callback (native tests / optional JS shim). */
  void setCallback(ContactCallback cb) { callback_ = std::move(cb); }

  /**
   * Observe a raw resolver contact. Dedupes within the current step by pair key
   * and keeps the sample with the largest impulse.
   */
  void pushContact(const ContactEvent& evt) {
    const uint64_t key = contactPairKey(evt.bodyId1, evt.bodyId2);
    auto it = current_.find(key);
    if (it == current_.end()) {
      current_.emplace(key, evt);
      return;
    }
    if (evt.impulse > it->second.impulse) {
      it->second = evt;
    }
  }

  /**
   * Classify Enter/Stay/Exit against the previous step, pack the emit buffer,
   * and dispatch the optional callback. Call only when at least one substep ran.
   */
  void flushEvents() {
    droppedThisStep_ = 0;
    emitted_.clear();

    std::vector<ContactEvent> exits;
    std::vector<ContactEvent> enters;
    std::vector<ContactEvent> stays;
    exits.reserve(previous_.size());
    enters.reserve(current_.size());
    stays.reserve(current_.size());

    for (const auto& prev : previous_) {
      if (current_.find(prev.first) == current_.end()) {
        ContactEvent e = prev.second;
        e.phase = ContactPhase::Exit;
        exits.push_back(e);
      }
    }
    for (const auto& cur : current_) {
      ContactEvent e = cur.second;
      if (previous_.find(cur.first) == previous_.end()) {
        e.phase = ContactPhase::Enter;
        enters.push_back(e);
      } else {
        e.phase = ContactPhase::Stay;
        stays.push_back(e);
      }
    }

    // Prefer edges over Stay if a cap is hit — scoring depends on Enter/Exit.
    const std::size_t total = exits.size() + enters.size() + stays.size();
    const std::size_t cap = maxContacts_;
    std::size_t kept = total;
    if (kept > cap) {
      droppedThisStep_ = static_cast<int>(kept - cap);
      droppedTotal_ += droppedThisStep_;
      kept = cap;
    }

    emitted_.reserve(kept);
    auto take = [&](std::vector<ContactEvent>& src) {
      for (auto& e : src) {
        if (emitted_.size() >= kept) return;
        emitted_.push_back(e);
      }
    };
    take(exits);
    take(enters);
    take(stays);

    packBuffer();

    if (callback_) {
      for (const auto& e : emitted_) {
        callback_(e);
      }
    }

    previous_ = std::move(current_);
    current_.clear();
  }

  /** Discard queued observations without emitting. Does not clear the manifold. */
  void clearEvents() { current_.clear(); }

  /** Forget persistent pairs (e.g. world reset). */
  void resetManifold() {
    current_.clear();
    previous_.clear();
    emitted_.clear();
    droppedThisStep_ = 0;
    writeCount_ = 0;
  }

  const float* getContactBufferPtr() const { return buffer_; }
  float* getContactBufferPtr() { return buffer_; }

  /** Number of contacts packed this step (after cap). */
  int getContactCount() const { return writeCount_; }

  /** Contacts discarded this step because of the cap (0 if lossless). */
  int getDroppedContactCount() const { return droppedThisStep_; }

  /** Lifetime dropped total (never silently lost without a counter). */
  int getDroppedContactTotal() const { return droppedTotal_; }

  void setMaxContacts(std::size_t maxContacts) {
    maxContacts_ = maxContacts == 0 ? 1 : maxContacts;
  }
  std::size_t getMaxContacts() const { return maxContacts_; }

  const std::vector<ContactEvent>& lastEvents() const { return emitted_; }

private:
  void packBuffer() {
    writeCount_ = static_cast<int>(emitted_.size());
    const std::size_t floats = emitted_.size() * static_cast<std::size_t>(CONTACT_STRIDE);
    ensureFloatCapacity(floats);
    float* dst = buffer_;
    for (const auto& e : emitted_) {
      dst[0]  = static_cast<float>(e.bodyId1);
      dst[1]  = static_cast<float>(e.bodyId2);
      dst[2]  = e.normal.x;
      dst[3]  = e.normal.y;
      dst[4]  = e.normal.z;
      dst[5]  = e.point.x;
      dst[6]  = e.point.y;
      dst[7]  = e.point.z;
      dst[8]  = e.impulse;
      dst[9]  = static_cast<float>(static_cast<int>(e.phase));
      dst[10] = e.isSensor ? 1.f : 0.f;
      dst[11] = 0.f;
      dst += CONTACT_STRIDE;
    }
  }

  void ensureFloatCapacity(std::size_t floats) {
    if (floats <= bufferCapFloats_) return;
    std::size_t bytes = floats * sizeof(float);
    bytes = (bytes + 15u) & ~std::size_t(15);
    void* p = std::aligned_alloc(16, bytes);
    if (!p) std::abort();
    if (buffer_ && bufferCapFloats_ > 0) {
      std::memcpy(p, buffer_, bufferCapFloats_ * sizeof(float));
      std::free(buffer_);
    }
    buffer_ = static_cast<float*>(p);
    bufferCapFloats_ = bytes / sizeof(float);
  }

  void freeBuffer() {
    if (buffer_) {
      std::free(buffer_);
      buffer_ = nullptr;
      bufferCapFloats_ = 0;
    }
  }

  void moveFrom(ContactListener& other) noexcept {
    callback_ = std::move(other.callback_);
    current_ = std::move(other.current_);
    previous_ = std::move(other.previous_);
    emitted_ = std::move(other.emitted_);
    buffer_ = other.buffer_;
    bufferCapFloats_ = other.bufferCapFloats_;
    writeCount_ = other.writeCount_;
    droppedThisStep_ = other.droppedThisStep_;
    droppedTotal_ = other.droppedTotal_;
    maxContacts_ = other.maxContacts_;
    other.buffer_ = nullptr;
    other.bufferCapFloats_ = 0;
    other.writeCount_ = 0;
  }

  ContactCallback callback_;
  std::unordered_map<uint64_t, ContactEvent> current_;
  std::unordered_map<uint64_t, ContactEvent> previous_;
  std::vector<ContactEvent> emitted_;

  float*      buffer_           = nullptr;
  std::size_t bufferCapFloats_  = 0;
  int         writeCount_       = 0;
  int         droppedThisStep_  = 0;
  int         droppedTotal_     = 0;
  std::size_t maxContacts_      = CONTACT_DEFAULT_MAX;
};

} // namespace pachinball
