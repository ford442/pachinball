import { 
  Scene, 
  TransformNode, 
  Mesh, 
  MeshBuilder, 
  Vector3, 
  PBRMaterial
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

    // Position in stack with slight randomness
    const stackIndex = this.balls.length
    const yOffset = stackIndex * this.config.ballScale * 0.8
    const randomX = (Math.random() - 0.5) * 0.1
    const randomZ = (Math.random() - 0.5) * 0.1
    
    ball.position = new Vector3(randomX, yOffset, randomZ)
    ball.parent = this.stackRoot

    // Add slight rotation for visual interest
    ball.rotation = new Vector3(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    )

    // Animate in (scale up)
    ball.scaling = new Vector3(0, 0, 0)
    this.animateBallIn(ball)

    this.balls.push({ mesh: ball, type })
    
    // Re-sort so solid gold is on top
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

  private animateBallIn(ball: Mesh): void {
    // Simple scale-up animation
    let frame = 0
    const animate = () => {
      frame++
      const progress = Math.min(frame / 10, 1)
      const scale = this.config.ballScale * this.easeOutBack(progress)
      ball.scaling = new Vector3(scale, scale, scale)
      
      if (progress < 1) {
        requestAnimationFrame(animate)
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
    // Sort: STANDARD first, then GOLD_PLATED, then SOLID_GOLD on top
    const typeOrder = { [BallType.STANDARD]: 0, [BallType.GOLD_PLATED]: 1, [BallType.SOLID_GOLD]: 2 }
    this.balls.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])
    
    // Update positions
    this.balls.forEach((ball, index) => {
      const yOffset = index * this.config.ballScale * 0.8
      ball.mesh.position.y = yOffset
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
