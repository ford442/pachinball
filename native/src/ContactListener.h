#pragma once

#include "MathTypes.h"
#include <functional>
#include <cstdint>

namespace pachinball {

/** A contact event between two rigid bodies. */
struct ContactEvent {
  int   bodyId1    = -1;      ///< ID of the first body
  int   bodyId2    = -1;      ///< ID of the second body
  Vec3  point;                ///< World-space contact point
  Vec3  normal;               ///< Contact normal (pointing from body2 to body1)
  float impulse    = 0.f;     ///< Impulse magnitude applied at the contact
  bool  isEntering = true;    ///< true = contact began, false = contact ended
};

/** Callback signature for contact events. */
using ContactCallback = std::function<void(const ContactEvent&)>;

/**
 * ContactListener — collects contact events during a physics step and
 * dispatches them via a registered callback.
 *
 * The ContactListener is owned by PhysicsWorld. Call setCallback() once
 * to register a handler; PhysicsWorld calls pushContact() during narrow-
 * phase collision resolution, then flushEvents() at the end of each step.
 */
class ContactListener {
public:
  ContactListener() = default;

  /** Register (or replace) the contact callback. */
  void setCallback(ContactCallback cb) { callback_ = std::move(cb); }

  /** Queue a contact event — called by PhysicsWorld during resolution. */
  void pushContact(const ContactEvent& evt) {
    if (pendingCount_ < MAX_PENDING) {
      pending_[pendingCount_++] = evt;
    }
  }

  /** Dispatch all queued events and reset the queue. */
  void flushEvents() {
    if (!callback_) return;
    for (std::size_t i = 0; i < pendingCount_; ++i) {
      callback_(pending_[i]);
    }
    pendingCount_ = 0;
  }

  /** Discard all queued events without firing them. */
  void clearEvents() { pendingCount_ = 0; }

private:
  static constexpr std::size_t MAX_PENDING = 256;
  ContactEvent  pending_[MAX_PENDING];
  std::size_t   pendingCount_ = 0;
  ContactCallback callback_;
};

} // namespace pachinball
