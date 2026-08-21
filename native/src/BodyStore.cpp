#include "BodyStore.h"
#include <cmath>
#include <algorithm>

namespace pachinball {

// ---- BodyView -----------------------------------------------------------

BodyView::BodyView(BodyStore* store, int denseIndex, int publicId)
    : store_(store), denseIndex_(denseIndex), publicId_(publicId) {}

bool BodyView::isActive() const {
  return store_ && store_->active_[static_cast<std::size_t>(denseIndex_)] != 0;
}

void BodyView::setActive(bool v) {
  if (!store_) return;
  store_->active_[static_cast<std::size_t>(denseIndex_)] = v ? 1 : 0;
  if (v) wake();
}

BodyType BodyView::getType() const {
  return static_cast<BodyType>(store_->type_[static_cast<std::size_t>(denseIndex_)]);
}

Shape BodyView::getShape() const {
  return static_cast<Shape>(store_->shape_[static_cast<std::size_t>(denseIndex_)]);
}

float BodyView::getRadius() const {
  return store_->radius_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getCapsuleHalfHeight() const {
  return store_->capsuleHalfHeight_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getMass() const {
  return store_->mass_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getInvMass() const {
  return store_->invMass_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getInvInertia() const {
  return store_->invInertia_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getRestitution() const {
  return store_->restitution_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getLinearDamping() const {
  return store_->linearDamping_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getFriction() const {
  return store_->friction_[static_cast<std::size_t>(denseIndex_)];
}

float BodyView::getAngularDamping() const {
  return store_->angularDamping_[static_cast<std::size_t>(denseIndex_)];
}

Vec3 BodyView::getPosition() const {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  return {store_->posX_[i], store_->posY_[i], store_->posZ_[i]};
}

Vec3 BodyView::getVelocity() const {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  return {store_->velX_[i], store_->velY_[i], store_->velZ_[i]};
}

Vec3 BodyView::getAngularVelocity() const {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  return {store_->angVelX_[i], store_->angVelY_[i], store_->angVelZ_[i]};
}

Quat BodyView::getRotation() const {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  return {store_->rotX_[i], store_->rotY_[i], store_->rotZ_[i], store_->rotW_[i]};
}

void BodyView::setPosition(const Vec3& p) {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->posX_[i] = p.x;
  store_->posY_[i] = p.y;
  store_->posZ_[i] = p.z;
  wake();
}

void BodyView::setVelocity(const Vec3& v) {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->velX_[i] = v.x;
  store_->velY_[i] = v.y;
  store_->velZ_[i] = v.z;
  wake();
}

void BodyView::setAngularVelocity(const Vec3& w) {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->angVelX_[i] = w.x;
  store_->angVelY_[i] = w.y;
  store_->angVelZ_[i] = w.z;
  wake();
}

void BodyView::setRotation(const Quat& q) {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->rotX_[i] = q.x;
  store_->rotY_[i] = q.y;
  store_->rotZ_[i] = q.z;
  store_->rotW_[i] = q.w;
}

void BodyView::applyForce(const Vec3& f) {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->forceX_[i] += f.x;
  store_->forceY_[i] += f.y;
  store_->forceZ_[i] += f.z;
  wake();
}

void BodyView::applyImpulse(const Vec3& imp) {
  const float invM = getInvMass();
  if (invM <= 0.f) return;
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->velX_[i] += imp.x * invM;
  store_->velY_[i] += imp.y * invM;
  store_->velZ_[i] += imp.z * invM;
  wake();
}

void BodyView::applyTorqueImpulse(const Vec3& torqueImp) {
  const float invI = getInvInertia();
  if (invI <= 0.f) return;
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->angVelX_[i] += torqueImp.x * invI;
  store_->angVelY_[i] += torqueImp.y * invI;
  store_->angVelZ_[i] += torqueImp.z * invI;
  wake();
}

void BodyView::applyImpulseAt(const Vec3& impulse, const Vec3& worldPoint) {
  applyImpulse(impulse);
  applyTorqueImpulse((worldPoint - getPosition()).cross(impulse));
}

void BodyView::clearForces() {
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->forceX_[i] = 0.f;
  store_->forceY_[i] = 0.f;
  store_->forceZ_[i] = 0.f;
}

void BodyView::integrate(float dt, const Vec3& gravity) {
  if (!store_) return;
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  if (store_->active_[i] == 0) return;
  if (static_cast<BodyType>(store_->type_[i]) != BodyType::Dynamic) return;

  const float mass = store_->mass_[i];
  const float invM = store_->invMass_[i];

  Vec3 totalForce{
    store_->forceX_[i] + gravity.x * mass,
    store_->forceY_[i] + gravity.y * mass,
    store_->forceZ_[i] + gravity.z * mass
  };

  store_->velX_[i] += totalForce.x * invM * dt;
  store_->velY_[i] += totalForce.y * invM * dt;
  store_->velZ_[i] += totalForce.z * invM * dt;

  const float linDamp = store_->linearDamping_[i];
  float dampFactor = 1.f - linDamp * dt;
  if (dampFactor < 0.f) dampFactor = 0.f;
  store_->velX_[i] *= dampFactor;
  store_->velY_[i] *= dampFactor;
  store_->velZ_[i] *= dampFactor;

  const float angDamp = store_->angularDamping_[i];
  float angDampFactor = 1.f - angDamp * dt;
  if (angDampFactor < 0.f) angDampFactor = 0.f;
  store_->angVelX_[i] *= angDampFactor;
  store_->angVelY_[i] *= angDampFactor;
  store_->angVelZ_[i] *= angDampFactor;

  store_->posX_[i] += store_->velX_[i] * dt;
  store_->posY_[i] += store_->velY_[i] * dt;
  store_->posZ_[i] += store_->velZ_[i] * dt;

  Quat q{store_->rotX_[i], store_->rotY_[i], store_->rotZ_[i], store_->rotW_[i]};
  const Quat omegaQuat{store_->angVelX_[i], store_->angVelY_[i], store_->angVelZ_[i], 0.f};
  q = (q + (omegaQuat * q) * (0.5f * dt)).normalized();
  store_->rotX_[i] = q.x;
  store_->rotY_[i] = q.y;
  store_->rotZ_[i] = q.z;
  store_->rotW_[i] = q.w;

  store_->forceX_[i] = 0.f;
  store_->forceY_[i] = 0.f;
  store_->forceZ_[i] = 0.f;
}

void BodyView::wake() {
  if (!store_) return;
  const std::size_t i = static_cast<std::size_t>(denseIndex_);
  store_->active_[i] = 1;
  store_->sleepCounter_[i] = 0;
}

// ---- BodyStore ----------------------------------------------------------

float BodyStore::computeInvInertia(const RigidBodyDesc& desc) {
  if (desc.type != BodyType::Dynamic || desc.mass <= 0.f) return 0.f;
  if (desc.shape == Shape::Sphere) {
    const float r2 = desc.radius * desc.radius;
    if (r2 < 1e-12f) return 0.f;
    return 2.5f / (desc.mass * r2);
  }
  if (desc.shape == Shape::Capsule) {
    const float r = desc.radius;
    const float h = 2.f * desc.capsuleHalfHeight;
    const float Iax = 0.5f * desc.mass * r * r;
    const float Ipp = (1.f / 12.f) * desc.mass * (3.f * r * r + h * h);
    const float I = (Iax + 2.f * Ipp) / 3.f;
    return I > 1e-12f ? 1.f / I : 0.f;
  }
  return 0.f;
}

void BodyStore::appendSlot(int publicId, const RigidBodyDesc& desc) {
  denseToPublicId_.push_back(publicId);

  posX_.push_back(desc.position.x);
  posY_.push_back(desc.position.y);
  posZ_.push_back(desc.position.z);

  velX_.push_back(desc.velocity.x);
  velY_.push_back(desc.velocity.y);
  velZ_.push_back(desc.velocity.z);

  angVelX_.push_back(0.f);
  angVelY_.push_back(0.f);
  angVelZ_.push_back(0.f);

  rotX_.push_back(0.f);
  rotY_.push_back(0.f);
  rotZ_.push_back(0.f);
  rotW_.push_back(1.f);

  forceX_.push_back(0.f);
  forceY_.push_back(0.f);
  forceZ_.push_back(0.f);

  mass_.push_back(desc.mass);
  invMass_.push_back(
    (desc.type == BodyType::Dynamic && desc.mass > 0.f) ? 1.f / desc.mass : 0.f);
  invInertia_.push_back(computeInvInertia(desc));
  radius_.push_back(desc.radius);
  capsuleHalfHeight_.push_back(desc.capsuleHalfHeight);
  restitution_.push_back(desc.restitution);
  friction_.push_back(desc.friction);
  linearDamping_.push_back(desc.linearDamping);
  angularDamping_.push_back(desc.angularDamping);

  type_.push_back(static_cast<uint8_t>(desc.type));
  shape_.push_back(static_cast<uint8_t>(desc.shape));
  active_.push_back(1);
  sleepCounter_.push_back(0);
}

void BodyStore::swapPop(int denseIndex) {
  const int last = denseCount() - 1;
  if (denseIndex < 0 || denseIndex > last) return;
  if (denseIndex == last) {
    denseToPublicId_.pop_back();
    posX_.pop_back(); posY_.pop_back(); posZ_.pop_back();
    velX_.pop_back(); velY_.pop_back(); velZ_.pop_back();
    angVelX_.pop_back(); angVelY_.pop_back(); angVelZ_.pop_back();
    rotX_.pop_back(); rotY_.pop_back(); rotZ_.pop_back(); rotW_.pop_back();
    forceX_.pop_back(); forceY_.pop_back(); forceZ_.pop_back();
    invMass_.pop_back(); invInertia_.pop_back();
    radius_.pop_back(); capsuleHalfHeight_.pop_back();
    restitution_.pop_back(); friction_.pop_back();
    linearDamping_.pop_back(); angularDamping_.pop_back();
    mass_.pop_back();
    type_.pop_back(); shape_.pop_back();
    active_.pop_back(); sleepCounter_.pop_back();
    return;
  }

  const std::size_t i = static_cast<std::size_t>(denseIndex);
  const std::size_t j = static_cast<std::size_t>(last);

  denseToPublicId_[i] = denseToPublicId_[j];
  posX_[i] = posX_[j]; posY_[i] = posY_[j]; posZ_[i] = posZ_[j];
  velX_[i] = velX_[j]; velY_[i] = velY_[j]; velZ_[i] = velZ_[j];
  angVelX_[i] = angVelX_[j]; angVelY_[i] = angVelY_[j]; angVelZ_[i] = angVelZ_[j];
  rotX_[i] = rotX_[j]; rotY_[i] = rotY_[j]; rotZ_[i] = rotZ_[j]; rotW_[i] = rotW_[j];
  forceX_[i] = forceX_[j]; forceY_[i] = forceY_[j]; forceZ_[i] = forceZ_[j];
  invMass_[i] = invMass_[j]; invInertia_[i] = invInertia_[j];
  radius_[i] = radius_[j]; capsuleHalfHeight_[i] = capsuleHalfHeight_[j];
  restitution_[i] = restitution_[j]; friction_[i] = friction_[j];
  linearDamping_[i] = linearDamping_[j]; angularDamping_[i] = angularDamping_[j];
  mass_[i] = mass_[j];
  type_[i] = type_[j]; shape_[i] = shape_[j];
  active_[i] = active_[j]; sleepCounter_[i] = sleepCounter_[j];

  swapPop(last);
}

int BodyStore::create(HandleTable& handles, const RigidBodyDesc& desc) {
  const int publicId = handles.allocateId();
  const int dense = denseCount();
  appendSlot(publicId, desc);
  handles.bind(publicId, dense);
  return publicId;
}

bool BodyStore::remove(HandleTable& handles, int publicId) {
  const int dense = handles.findDenseIndex(publicId);
  if (dense < 0) return false;

  const int movedPublicId = (dense < denseCount() - 1) ? denseToPublicId_[static_cast<std::size_t>(denseCount() - 1)] : -1;

  swapPop(dense);
  handles.kill(publicId);

  if (movedPublicId >= 0) {
    handles.bind(movedPublicId, dense);
  }
  return true;
}

BodyView BodyStore::view(int denseIndex) {
  if (denseIndex < 0 || denseIndex >= denseCount()) return {};
  return BodyView(this, denseIndex, denseToPublicId_[static_cast<std::size_t>(denseIndex)]);
}

BodyView BodyStore::viewById(HandleTable& handles, int publicId) {
  const int dense = handles.findDenseIndex(publicId);
  if (dense < 0) return {};
  return view(dense);
}

void BodyStore::integrateAll(float dt, const Vec3& gravity) {
  const int n = denseCount();
  for (int i = 0; i < n; ++i) {
    if (!isActive(i)) continue;
    view(i).integrate(dt, gravity);
  }
}

void BodyStore::updateSleep(float linearThreshold, float angularThreshold, int framesRequired) {
  const float linSq = linearThreshold * linearThreshold;
  const float angSq = angularThreshold * angularThreshold;
  const int n = denseCount();

  for (int i = 0; i < n; ++i) {
    const std::size_t si = static_cast<std::size_t>(i);
    if (active_[si] == 0) continue;
    if (static_cast<BodyType>(type_[si]) != BodyType::Dynamic) {
      // Kinematic proxies stay awake.
      sleepCounter_[si] = 0;
      continue;
    }

    const float vx = velX_[si], vy = velY_[si], vz = velZ_[si];
    const float wx = angVelX_[si], wy = angVelY_[si], wz = angVelZ_[si];
    const float vSq = vx * vx + vy * vy + vz * vz;
    const float wSq = wx * wx + wy * wy + wz * wz;

    if (vSq <= linSq && wSq <= angSq) {
      const int next = static_cast<int>(sleepCounter_[si]) + 1;
      sleepCounter_[si] = static_cast<uint16_t>(std::min(next, 65535));
      if (next >= framesRequired) {
        active_[si] = 0;
      }
    } else {
      sleepCounter_[si] = 0;
    }
  }
}

int BodyStore::activeCount() const {
  int count = 0;
  for (uint8_t a : active_) {
    if (a != 0) ++count;
  }
  return count;
}

void BodyStore::scatterTransformSlot(int publicId, float* dst, int stride) const {
  if (!dst || stride <= 0) return;
  float* slot = dst + static_cast<std::size_t>(publicId) * static_cast<std::size_t>(stride);
  for (int k = 0; k < stride; ++k) slot[k] = 0.f;

  int dense = -1;
  for (int i = 0; i < denseCount(); ++i) {
    if (denseToPublicId_[static_cast<std::size_t>(i)] == publicId) {
      dense = i;
      break;
    }
  }
  if (dense < 0) return;

  const std::size_t i = static_cast<std::size_t>(dense);
  slot[0]  = static_cast<float>(publicId);
  slot[1]  = posX_[i];
  slot[2]  = posY_[i];
  slot[3]  = posZ_[i];
  slot[4]  = rotX_[i];
  slot[5]  = rotY_[i];
  slot[6]  = rotZ_[i];
  slot[7]  = rotW_[i];
  slot[8]  = velX_[i];
  slot[9]  = velY_[i];
  slot[10] = velZ_[i];
  slot[11] = angVelX_[i];
  slot[12] = angVelY_[i];
  slot[13] = angVelZ_[i];
  slot[14] = static_cast<float>(active_[i]);
}

} // namespace pachinball
