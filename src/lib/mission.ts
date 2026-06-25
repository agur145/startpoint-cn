// Mission CDN data loader — reads mission definitions + reward stage thresholds
import regularMissions from "../../assets/mission_regular.json";
import dailyMissions from "../../assets/mission_daily.json";
import eventMissions from "../../assets/mission_event.json";
import degreeMissions from "../../assets/mission_degree.json";
import collectItemMissions from "../../assets/mission_collect_item.json";

import regularRewards from "../../assets/mission_regular_reward.json";
import dailyRewards from "../../assets/mission_daily_reward.json";
import eventRewards from "../../assets/mission_event_reward.json";
import degreeRewards from "../../assets/mission_degree_reward.json";
import collectItemRewards from "../../assets/mission_collect_item_reward.json";

// Category mapping: client API category → (missions table, rewards table)
// 1=Regular, 2=Daily, 3=Event, 4=CollectItemEvent, 5=Degree
// 6=PassCardDaily, 7=PassCardWeek, 8=PassCardEvent (not loaded yet)
// 10=StoryEvent → mapped to Event for now

interface MissionStage {
    stage: number;
    targetProgress: number;
}

function missionIds(table: Record<string, any>): Set<number> {
    return new Set(Object.keys(table).map(Number));
}

function buildStages(rewardTable: Record<string, Record<string, any>>): Record<string, MissionStage[]> {
    const result: Record<string, MissionStage[]> = {};
    for (const [missionId, stages] of Object.entries(rewardTable)) {
        const list: MissionStage[] = [];
        for (const [stageStr, rows] of Object.entries(stages)) {
            const row = (rows as any[])[0];
            const targetProgress = parseInt(row[5] || row[1] || "0");
            const stage = parseInt(stageStr);
            list.push({ stage, targetProgress });
        }
        list.sort((a, b) => a.targetProgress - b.targetProgress);
        result[missionId] = list;
    }
    return result;
}

const missionIdSets: Record<number, Set<number>> = {
    1:  missionIds(regularMissions as any),
    2:  missionIds(dailyMissions as any),
    3:  missionIds(eventMissions as any),
    4:  missionIds(collectItemMissions as any),
    5:  missionIds(degreeMissions as any),
    10: missionIds(eventMissions as any),  // StoryEvent → uses Event table
};

const missionStageLookup: Record<number, Record<string, MissionStage[]>> = {
    1:  buildStages(regularRewards as any),
    2:  buildStages(dailyRewards as any),
    3:  buildStages(eventRewards as any),
    4:  buildStages(collectItemRewards as any),
    5:  buildStages(degreeRewards as any),
    10: buildStages(eventRewards as any),
};

/**
 * Get all mission IDs for a given category.
 */
export function getAllMissionIds(category: number): number[] {
    return Array.from(missionIdSets[category] || new Set<number>());
}

/**
 * Determine the current stage for a mission given player progress.
 * Returns 1 if no stages defined (unrewarded mission).
 */
export function getCurrentStage(category: number, missionId: number, progress: number): number {
    const stages = missionStageLookup[category]?.[String(missionId)];
    if (!stages || stages.length === 0) return 1;
    let current = stages[stages.length - 1].stage;
    for (const s of stages) {
        if (progress < s.targetProgress) {
            current = s.stage;
            break;
        }
    }
    return current;
}
