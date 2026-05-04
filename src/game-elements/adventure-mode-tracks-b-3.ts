import { Vector3 } from '@babylonjs/core'

// Implementation helpers for AdventureModeTracksB (part 3)

export function createTeslaTowerTrackImpl(host: any): void {
  const towerMat = host.getTrackMaterial('#22EEFF')
  const coilMat = host.getTrackMaterial('#FFA500')
  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const entryLen = 14
  const entryIncline = (14 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, towerMat)

  const towerBasePos = currentPos.add(new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(5))
  host.createStaticCylinder(towerBasePos, 3.0, 10.0, coilMat)

  const spiralRadius = 12
  const spiralAngle = Math.PI * 1.25
  const spiralIncline = (8 * Math.PI) / 180
  currentPos = host.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 5, 1.2, towerMat, 24, 0.15)
  heading += spiralAngle

  currentPos = host.addStraightRamp(currentPos, heading, 5, 10, 0, towerMat)
  currentPos = host.addCurvedRamp(currentPos, heading, 8, Math.PI / 2, -(5 * Math.PI) / 180, 5, 1.0, towerMat, 16, -0.12)
  heading += Math.PI / 2

  const goalPos = currentPos.clone().add(new Vector3(Math.sin(heading) * 4, 0, Math.cos(heading) * 4))
  host.createBasin(goalPos, towerMat)
}

export function createNeonSkylineTrackImpl(host: any): void {
  const skyMat = host.getTrackMaterial('#FF00FF')
  const neonMat = host.getTrackMaterial('#00FFFF')
  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const entryLen = 10
  const entryIncline = (12 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 5, entryLen, entryIncline, neonMat)

  const buildings = [
    { offset: new Vector3(3, 0, 5), diameter: 2.5, height: 9 },
    { offset: new Vector3(-3, 0, 8), diameter: 2.0, height: 7 },
    { offset: new Vector3(2, 0, 12), diameter: 1.8, height: 8 },
  ]

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  buildings.forEach(building => {
    const pos = currentPos.add(building.offset)
    host.createStaticCylinder(pos, building.diameter, building.height, skyMat)
  })

  currentPos = host.addCurvedRamp(currentPos, heading, 10, Math.PI / 2, 0, 4.5, 1.0, neonMat, 18, 0.18)
  heading += Math.PI / 2
  currentPos = host.addStraightRamp(currentPos, heading, 4, 9, -(6 * Math.PI) / 180, neonMat)

  const sideBuildings = [
    { offset: new Vector3(5, 0, -2), diameter: 1.5, height: 6 },
    { offset: new Vector3(-4, 0, 2), diameter: 2.2, height: 8 },
  ]
  sideBuildings.forEach(building => {
    const pos = currentPos.add(building.offset)
    host.createStaticCylinder(pos, building.diameter, building.height, skyMat)
  })

  currentPos = host.addCurvedRamp(currentPos, heading, 8, -Math.PI / 2, 0, 4.0, 1.0, neonMat, 16, -0.15)
  heading -= Math.PI / 2
  currentPos = host.addStraightRamp(currentPos, heading, 4, 8, 0, neonMat)

  const goalPos = currentPos.clone().add(new Vector3(Math.sin(heading) * 3, 0, Math.cos(heading) * 3))
  host.createBasin(goalPos, neonMat)
}
