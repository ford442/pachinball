import { 
  Scene, 
  TransformNode, 
  Mesh, 
  MeshBuilder, 
  Vector3, 
  PBRMaterial,
  Color3
} from '@babylonjs/core'
import { BallType } from '../config'
import { getMaterialLibrary } from '../materials'

export interface BallStackConfig {
  position: Vector3
  maxStackSize: number
  ballScale: number
}

export class BallStackVisual {
  private scene: Scene
  private stackRoot: TransformNode
  private balls: Array<{ mesh: Mesh; type: BallType }> = []
  private config: BallStackConfig
  private matLib: ReturnType<typeof getMaterialLibrary>

  constructor(scene: Scene, config: Partial<BallStackConfig> = {}) {
    this.scene = scene
    this.matLib = getMaterialLibrary(scene)
    this.config = {
      position: new Vector3(12, 2, -15), // Corner of cabinet
      maxStackSize: 10,
      ballScale: 0.15,
      ...config
    }
    
    this.stackRoot = new TransformNode('ballStackRoot', scene)
    this.stackRoot.position = this.config.position
    // Face the arc toward the player
    this.stackRoot.rotation.y = Math.PI / 6
  }

  /**
   * Add a ball to the visual stack
   */
  addBall(type: BallType): void {
    if (this.balls.length >= this.config.maxStackSize) {
      // Remove oldest ball if at max
      const oldest = this.balls.shift()
      oldest?.mesh.dispose()
    }

    // Create small ball mesh
    const ball = MeshBuilder.CreateSphere(
      `stackBall_${type}_${Date.now()}`,
      { diameter: 1, segments: 16 },
      this.scene
    ) as Mesh

    // Apply material based on type
    ball.material = this.getMaterialForType(type)
    ball.scaling = new Vector3(
      this.config.ballScale,
      this.config.ballScale,
      this.config.ballScale
    )

    // Position in horizontal arc meter
    const stackIndex = this.balls.length
    const spacing = this.config.ballScale * 0.9
    const arcX = stackIndex * spacing
    const arcY = Math.sin(stackIndex * 0.3) * this.config.ballScale * 0.3
    ball.position = new Vector3(arcX, arcY, 0)
    ball.parent = this.stackRoot

    // Add slight rotation for visual interest
    ball.rotation = new Vector3(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    )

    // Threshold pulse for high counts (8+)
    const isNearJackpot = this.balls.length >= 7
    ball.scaling = new Vector3(0, 0, 0)
    this.animateBallIn(ball, isNearJackpot)
    if (isNearJackpot) {
      this.flashBallEmissive(ball)
    }

    this.balls.push({ mesh: ball, type })
    
    // Re-sort so solid gold is at the front (right end) of the arc
    this.reorderStack()
  }

  private getMaterialForType(type: BallType): PBRMaterial {
    switch (type) {
      case BallType.SOLID_GOLD:
        return this.matLib.getSolidGoldBallMaterial()
      case BallType.GOLD_PLATED:
        return this.matLib.getGoldPlatedBallMaterial()
      default:
        return this.matLib.getEnhancedChromeBallMaterial()
    }
  }

  private animateBallIn(ball: Mesh, exaggerated = false): void {
    // Scale-up animation with optional exaggerated pop for threshold moments
    let frame = 0
    const overshoot = exaggerated ? 1.6 : 1.0
    const duration = exaggerated ? 20 : 10
    const animate = () => {
      frame++
      const progress = Math.min(frame / duration, 1)
      const baseScale = this.config.ballScale * this.easeOutBack(progress)
      const scale = baseScale * (1 + Math.sin(progress * Math.PI) * (overshoot - 1))
      ball.scaling = new Vector3(scale, scale, scale)
      
      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        ball.scaling = new Vector3(this.config.ballScale, this.config.ballScale, this.config.ballScale)
      }
    }
    animate()
  }

  private flashBallEmissive(ball: Mesh): void {
    const mat = ball.material as PBRMaterial
    if (!mat) return
    const originalEmissive = mat.emissiveColor.clone()
    const originalIntensity = mat.emissiveIntensity
    mat.emissiveColor = new Color3(1, 0.9, 0.4)
    mat.emissiveIntensity = 1.5

    let frame = 0
    const animate = () => {
      frame++
      const progress = Math.min(frame / 30, 1)
      mat.emissiveColor = Color3.Lerp(new Color3(1, 0.9, 0.4), originalEmissive, progress)
      mat.emissiveIntensity = originalIntensity + (1.5 - originalIntensity) * (1 - progress)
      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        mat.emissiveColor = originalEmissive
        mat.emissiveIntensity = originalIntensity
      }
    }
    animate()
  }

  private easeOutBack(x: number): number {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
  }

  private reorderStack(): void {
    // Sort: STANDARD first (left), then GOLD_PLATED, then SOLID_GOLD at front (right)
    const typeOrder = { [BallType.STANDARD]: 0, [BallType.GOLD_PLATED]: 1, [BallType.SOLID_GOLD]: 2 }
    this.balls.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])
    
    // Update positions along the horizontal arc
    this.balls.forEach((ball, index) => {
      const spacing = this.config.ballScale * 0.9
      const arcX = index * spacing
      const arcY = Math.sin(index * 0.3) * this.config.ballScale * 0.3
      ball.mesh.position.x = arcX
      ball.mesh.position.y = arcY
      ball.mesh.position.z = 0
    })
  }

  /**
   * Get current stack count
   */
  getCount(): number {
    return this.balls.length
  }

  /**
   * Get count by type
   */
  getCountByType(type: BallType): number {
    return this.balls.filter(b => b.type === type).length
  }

  /**
   * Clear the stack
   */
  clear(): void {
    this.balls.forEach(b => b.mesh.dispose())
    this.balls = []
  }

  /**
   * Dispose the entire stack
   */
  dispose(): void {
    this.clear()
    this.stackRoot.dispose()
  }
}
