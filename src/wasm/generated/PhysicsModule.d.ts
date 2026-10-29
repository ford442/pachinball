// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let HEAPF32: Float32Array;
    let HEAPU32: Uint32Array;
}
interface WasmModule {
  _free(_0: number): void;
  _malloc(_0: number): number;
}

export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface BodyTypeValue<T extends number> {
  value: T;
}
export type BodyType = BodyTypeValue<0>|BodyTypeValue<1>|BodyTypeValue<2>;

export interface ShapeValue<T extends number> {
  value: T;
}
export type Shape = ShapeValue<0>|ShapeValue<1>|ShapeValue<2>;

export interface VolumeShapeValue<T extends number> {
  value: T;
}
export type VolumeShape = VolumeShapeValue<0>|VolumeShapeValue<1>|VolumeShapeValue<2>;

export interface ForceSpaceValue<T extends number> {
  value: T;
}
export type ForceSpace = ForceSpaceValue<0>|ForceSpaceValue<1>;

export interface PhysicsWorld extends ClassHandle {
  clearStaticGeometry(): void;
  removeRigidBody(_0: number): void;
  setBodyType(_0: number, _1: number): void;
  getBodyType(_0: number): number;
  removeHinge(_0: number): void;
  getDroppedStaticCount(): number;
  getPinFieldPinCount(_0: number): number;
  setForceFieldEnabled(_0: number, _1: boolean): void;
  getActiveBodyCount(): number;
  getContactCount(): number;
  getDroppedContactCount(): number;
  setMaxContacts(_0: number): void;
  getMaxContacts(): number;
  getTransformStride(): number;
  getTransformSlotCount(): number;
  setCollisionGroups(_0: number, _1: number, _2: number): void;
  getContactBufferPtr(): number;
  getTransformBufferPtr(): number;
  getStepCount(): bigint;
  getStaticContentHash(): bigint;
  getContactGeneration(): bigint;
  createRigidBodyDesc(_0: RigidBodyDesc): number;
  createRigidBody(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number, _13: number, _14: number): number;
  createBoxBody(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number, _13: number, _14: number): number;
  applyForce(_0: number, _1: number, _2: number, _3: number): void;
  applyImpulse(_0: number, _1: number, _2: number, _3: number): void;
  setVelocity(_0: number, _1: number, _2: number, _3: number): void;
  setAngularVelocity(_0: number, _1: number, _2: number, _3: number): void;
  setBodyPosition(_0: number, _1: number, _2: number, _3: number): void;
  setBodyRotation(_0: number, _1: number, _2: number, _3: number, _4: number): void;
  createHinge(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number): number;
  setHingeMotor(_0: number, _1: number, _2: number): void;
  getHingeAngle(_0: number): number;
  addStaticPlane(_0: number, _1: number, _2: number, _3: number, _4: number): void;
  addStaticBox(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number): number;
  addStaticCapsule(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number): number;
  addStaticCylinder(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number): number;
  addStaticSphere(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number): number;
  addStaticCone(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number): number;
  addStaticTriangleMesh(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: boolean): number;
  addPinField(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number, _13: number, _14: number, _15: number, _16: number, _17: number, _18: number, _19: number, _20: number, _21: number): number;
  addForceField(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number, _13: number, _14: boolean): number;
  addAxisPullField(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: boolean): number;
  setForceFieldVector(_0: number, _1: number, _2: number, _3: number): void;
  addKinematicMover(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number): number;
  addKinematicMoverShaped(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number): number;
  setNextKinematicTransform(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number): void;
  addSensorVolume(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number): number;
  addSensorVolumeShaped(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number): number;
  getPosX(_0: number): number;
  getPosY(_0: number): number;
  getPosZ(_0: number): number;
  getVelX(_0: number): number;
  getVelY(_0: number): number;
  getVelZ(_0: number): number;
  getAngVelX(_0: number): number;
  getAngVelY(_0: number): number;
  getAngVelZ(_0: number): number;
  getRotX(_0: number): number;
  getRotY(_0: number): number;
  getRotZ(_0: number): number;
  getRotW(_0: number): number;
  step(_0: number): number;
  setGravity(_0: number, _1: number, _2: number): void;
  setRollingResistance(_0: number): void;
  getRollingResistance(): number;
  setContactCallbackJS(_0: any): void;
  serializeSnapshot(): any;
  restoreSnapshot(_0: any): number;
}

export type Vec3 = {
  x: number,
  y: number,
  z: number
};

export type WorldParams = {
  fixedTimestep: number,
  maxSubsteps: number,
  solverIterations: number,
  rollingResistance: number
};

export type RigidBodyDesc = {
  position: Vec3,
  velocity: Vec3,
  mass: number,
  radius: number,
  restitution: number,
  linearDamping: number,
  type: BodyType,
  shape: Shape,
  capsuleHalfHeight: number,
  friction: number,
  angularDamping: number
};

export type HingeDesc = {
  worldAnchor: Vec3,
  worldAxis: Vec3,
  minAngle: number,
  maxAngle: number,
  motorTargetVel: number,
  motorMaxTorque: number,
  baumgarte: number
};

interface EmbindModule {
  BodyType: {Dynamic: BodyTypeValue<0>, Static: BodyTypeValue<1>, Kinematic: BodyTypeValue<2>};
  Shape: {Sphere: ShapeValue<0>, Capsule: ShapeValue<1>, Box: ShapeValue<2>};
  VolumeShape: {Box: VolumeShapeValue<0>, Cylinder: VolumeShapeValue<1>, Sphere: VolumeShapeValue<2>};
  ForceSpace: {World: ForceSpaceValue<0>, Local: ForceSpaceValue<1>};
  PhysicsWorld: {
    new(): PhysicsWorld;
  };
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
