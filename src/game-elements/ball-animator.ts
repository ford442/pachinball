import {
  Scene,
  Mesh,
  Vector3,
  Animation,
  ElasticEase,
  EasingFunction,
  Quaternion,
} from '@babylonjs/core'

/**
 * BallAnimator - Handles squash-and-stretch animations for ball impacts
 * 
 * This is a purely visual system that deforms the ball mesh on collision
 * to create a "juicy" feel. It does NOT affect physics - the physics body
 * remains a perfect sphere at all times.
 */
export class BallAnimator {
  /** Track active animations to prevent overlaps and memory leaks */
  private activeAnimations: Map<Mesh, Animation> = new Map()

  constructor(private scene: Scene) {}

  /**
   * Animate a ball impact with squash-and-stretch deformation
   * 
   * @param mesh - The ball mesh to animate
   * @param impactNormal - The normal vector of the collision (direction of impact)
   * @param intensity - Impact intensity (0-1), typically derived from velocity
   */
  animateBallImpact(mesh: Mesh, impactNormal: Vector3, intensity: number): void {
    // Clamp intensity to valid range
    const clampedIntensity = Math.max(0, Math.min(1, intensity))
    
    // Skip very weak impacts
    if (clampedIntensity < 0.1) return

    // Cancel any existing animation on this mesh
    this.stopAnimation(mesh)

    // Store original scale for restoration
    const originalScale = mesh.scaling?.clone() || new Vector3(1, 1, 1)

    // Calculate squash-and-stretch based on impact normal
    // We want to:
    // - SQUASH perpendicular to impact (flatten against surface)
    // - STRETCH along impact direction
    const squashFactor = 0.3 * clampedIntensity
    const stretchFactor = 0.2 * clampedIntensity

    // Build rotation to align with impact normal
    const up = new Vector3(0, 1, 0)
    const rotationAxis = Vector3.Cross(up, impactNormal)
    const rotationAngle = Math.acos(Vector3.Dot(up, impactNormal.normalize()))
    
    // Create rotation quaternion (if not parallel)
    let rotationQuaternion: Quaternion | null = null
    if (rotationAxis.length() > 0.001) {
      rotationQuaternion = Quaternion.RotationAxis(rotationAxis.normalize(), rotationAngle)
    }

    // Calculate squash scale in local space
    // Y axis aligns with impact normal (stretch), X/Z squash
    const squashScale = new Vector3(
      1 - squashFactor,  // X: squash
      1 + stretchFactor, // Y: stretch along impact
      1 - squashFactor   // Z: squash
    )

    // Create the squash animation
    const squashAnim = new Animation(
      'ballSquash',
      'scaling',
      60, // FPS
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    )

    // Animation keys: normal -> squash -> overshoot -> normal
    const keys = [
      { frame: 0, value: originalScale },
      { frame: 2, value: squashScale },
      { frame: 6, value: new Vector3(
        1 + squashFactor * 0.5,
        1 - stretchFactor * 0.3,
        1 + squashFactor * 0.5
      )}, // Slight bounce-back
      { frame: 10, value: originalScale },
    ]

    squashAnim.setKeys(keys)

    // Add elastic easing for "juicy" feel
    const easing = new ElasticEase()
    easing.setEasingMode(EasingFunction.EASINGMODE_EASEOUT)
    easing.oscillations = 2
    easing.springiness = 3
    squashAnim.setEasingFunction(easing)

    // Apply rotation if we have a valid impact normal
    if (rotationQuaternion) {
      // Store original rotation
      const originalRotation = mesh.rotationQuaternion?.clone() || Quaternion.Identity()
      
      // Create rotation animation
      const rotationAnim = new Animation(
        'ballSquashRotation',
        'rotationQuaternion',
        60,
        Animation.ANIMATIONTYPE_QUATERNION,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      )

      rotationAnim.setKeys([
        { frame: 0, value: originalRotation },
        { frame: 2, value: rotationQuaternion },
        { frame: 10, value: originalRotation },
      ])

      mesh.animations = [squashAnim, rotationAnim]
    } else {
      mesh.animations = [squashAnim]
    }

    // Track this animation
    this.activeAnimations.set(mesh, squashAnim)

    // Start animation
    const animatable = this.scene.beginAnimation(mesh, 0, 10, false)

    // Cleanup when animation completes
    animatable.onAnimationEnd = () => {
      // Ensure scale is restored exactly
      mesh.scaling = originalScale
      
      // Clear animations array
      mesh.animations = []
      
      // Remove from tracking
      this.activeAnimations.delete(mesh)
    }
  }

  /**
   * Simple impact animation without directional alignment
   * Useful for general collisions where impact normal is unknown
   * 
   * @param mesh - The ball mesh to animate
   * @param intensity - Impact intensity (0-1)
   */
  animateSimpleImpact(mesh: Mesh, intensity: number): void {
    const clampedIntensity = Math.max(0, Math.min(1, intensity))
    if (clampedIntensity < 0.1) return

    this.stopAnimation(mesh)

    const originalScale = mesh.scaling?.clone() || new Vector3(1, 1, 1)
    
    // Simple uniform squash then stretch
    const squashFactor = 0.25 * clampedIntensity

    const squashAnim = new Animation(
      'ballSimpleSquash',
      'scaling',
      60,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    )

    squashAnim.setKeys([
      { frame: 0, value: originalScale },
      { frame: 2, value: new Vector3(
        1 + squashFactor,
        1 - squashFactor * 0.7,
        1 + squashFactor
      )},
      { frame: 5, value: new Vector3(
        1 - squashFactor * 0.3,
        1 + squashFactor * 0.5,
        1 - squashFactor * 0.3
      )},
      { frame: 10, value: originalScale },
    ])

    const easing = new ElasticEase()
    easing.setEasingMode(EasingFunction.EASINGMODE_EASEOUT)
    easing.oscillations = 1
    easing.springiness = 2.5
    squashAnim.setEasingFunction(easing)

    mesh.animations = [squashAnim]
    this.activeAnimations.set(mesh, squashAnim)

    const animatable = this.scene.beginAnimation(mesh, 0, 10, false)
    animatable.onAnimationEnd = () => {
      mesh.scaling = originalScale
      mesh.animations = []
      this.activeAnimations.delete(mesh)
    }
  }

  /**
   * Stop any active animation on a mesh
   */
  stopAnimation(mesh: Mesh): void {
    if (this.activeAnimations.has(mesh)) {
      this.scene.stopAnimation(mesh)
      this.activeAnimations.delete(mesh)
    }
  }

  /**
   * Dispose and cleanup all resources
   */
  dispose(): void {
    for (const mesh of this.activeAnimations.keys()) {
      this.scene.stopAnimation(mesh)
      mesh.animations = []
    }
    this.activeAnimations.clear()
  }
}
