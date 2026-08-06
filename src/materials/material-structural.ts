/**
 * Structural Materials - Cabinet, playfield, and structural surface materials
 *
 * Thin orchestrator that composes the structural material concerns:
 * ORM channel packing, cabinet surfaces, the playfield grid, and the LCD
 * table display. See material-orm.ts, material-cabinet.ts,
 * material-playfield.ts, and material-lcd-table.ts for the implementations.
 */

import { LCDTableMaterials } from './material-lcd-table'

export class StructuralMaterials extends LCDTableMaterials {}
