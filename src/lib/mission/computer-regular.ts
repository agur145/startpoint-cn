// Regular & Daily mission computer (categories 1, 2)

import { getPlayerSync, getPlayerQuestProgressSync } from "../../data/wdfpData"
import { isComputablePattern, getMissionPattern } from "./patterns"
import type { MissionComputer, CategoryContext } from "./types"

function buildStats(playerId: number): CategoryContext {
    const player = getPlayerSync(playerId)!
    const questProgressRaw = getPlayerQuestProgressSync(playerId)

    let totalQuestClears = 0, ssClears = 0, sClears = 0, aClears = 0, bClears = 0, totalStories = 0
    const questProgress: CategoryContext["questProgress"] = {}

    for (const [section, quests] of Object.entries(questProgressRaw)) {
        const list: CategoryContext["questProgress"][string] = []
        for (const qp of quests) {
            list.push({ questId: qp.questId, finished: qp.finished, clearRank: qp.clearRank, bestElapsedTimeMs: qp.bestElapsedTimeMs, leaderCharacterId: qp.leaderCharacterId })
            if (qp.finished) {
                totalQuestClears++
                if (section === '3') totalStories++
                if (qp.clearRank === 6) ssClears++
                else if (qp.clearRank === 5) sClears++
                else if (qp.clearRank === 4) aClears++
                else if (qp.clearRank === 3) bClears++
            }
        }
        questProgress[section] = list
    }

    return {
        playerId,
        player,
        questProgress,
        totalQuestClears,
        totalStories,
        rankCounts: { rank_ss: ssClears, rank_s: sClears, rank_a: aClears, rank_b: bClears },
    }
}

export const RegularComputer: MissionComputer = {
    name: "Regular",

    buildContext(playerId: number): CategoryContext {
        return buildStats(playerId)
    },

    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number {
        const categories = [1, 2] // handled by this computer
        for (const cat of categories) {
            const pattern = getMissionPattern(cat, missionId)
            if (pattern && isComputablePattern(pattern)) {
                if (pattern.startsWith('single_battle_play') || pattern.startsWith('single_battle_clear_count'))
                    return ctx.totalQuestClears
                if (pattern.includes('stamina_use'))
                    return ctx.player.totalStaminaUsed ?? 0
                if (ctx.rankCounts[pattern] !== undefined)
                    return ctx.rankCounts[pattern]
            }
        }
        return dbProgress
    },
}
