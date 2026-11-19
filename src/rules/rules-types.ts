/**
 * The rules a run plays under (#556): the scoring part of `MachineDescriptor.rules` with its program
 * resolved — `balls`, `fever` and `program`, never `cascade` (the table is pinned by the tape's
 * static hash, not by its rules). This is the object `rulesHash` hashes and a tape carries inline.
 *
 * Types only.
 */

import type { MachineRules } from '../schemas/rules'
import type { RulesProgram } from '../schemas/rules-program'

export type RunRules = Pick<MachineRules, 'balls' | 'fever'> & { program: RulesProgram }
