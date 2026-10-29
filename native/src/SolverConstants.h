#pragma once

namespace pachinball {

/**
 * Squared distance below which a contact's two points coincide and the
 * normal is undefined — resolvers fall back to a face / axis normal. One
 * definition shared by every translation unit (a per-file copy collides in
 * a unity build).
 */
inline constexpr float CONTACT_EPSILON_SQ = 1e-10f;

} // namespace pachinball
