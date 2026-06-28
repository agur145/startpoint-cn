// Mission computer dispatch registry

import { MissionComputer, ComputerRegistry } from "./types"
import { RegularComputer } from "./computer-regular"
import { DegreeComputer } from "./computer-degree"
import { AwakeComputer } from "./computer-awake"
import { FallbackComputer } from "./computer-fallback"

const REGISTRY: ComputerRegistry = new Map([
    [1, RegularComputer],
    [2, RegularComputer],
    [5, DegreeComputer],
    [9, AwakeComputer],
    // Category 3,4,10 → Fallback (DB-stored progress)
])

export function getComputer(category: number): MissionComputer {
    return REGISTRY.get(category) ?? FallbackComputer
}
