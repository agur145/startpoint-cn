// Mission computer core types

import type { Player, PlayerCharacter, RawPlayerQuestProgress } from "../../data/types"

export interface PlayerQuestProgressEntry {
    questId: number
    finished: boolean
    clearRank: number | null | undefined
    bestElapsedTimeMs: number | undefined
    leaderCharacterId: number | undefined
}

/** Per-category pre-computed context — built once, read many times */
export interface CategoryContext {
    playerId: number
    player: Player
    questProgress: Record<string, PlayerQuestProgressEntry[]>
    totalQuestClears: number
    totalStories: number
    rankCounts: Record<string, number>
}

/** A mission computer handles one or more categories */
export interface MissionComputer {
    readonly name: string

    /**
     * Build pre-cached context for this category.
     * All DB I/O happens here — compute() must be pure.
     */
    buildContext(playerId: number): CategoryContext

    /**
     * Compute progress for a single mission.
     * NO DB calls inside — use ctx for all data.
     * @param missionId The mission ID to compute
     * @param ctx Pre-built category context
     * @param dbProgress Fallback value from active_missions table
     */
    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number
}

export type ComputerRegistry = Map<number, MissionComputer>
