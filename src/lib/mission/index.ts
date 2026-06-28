// lib/mission barrel — unified mission system

// Types
export type { MissionComputer, CategoryContext, ComputerRegistry, PlayerQuestProgressEntry } from "./types"

// Registry
export { getComputer } from "./registry"

// Stages
export { getMissionIdsByCategory, getCurrentStage, getCompletedStageNumbers } from "./stages"

// Rewards
export type { ActiveMissionReward } from "./rewards"
export { getActiveMissionRewards, getAwakeMissionRewards } from "./rewards"

// Patterns (for update_mission_progress)
export type { PatternMatch } from "./patterns"
export { getMissionsByPattern, getMissionPattern, isComputablePattern } from "./patterns"

// Character queries
export { getCharacterStoryQuestIds, getCharacterIdFromMission } from "./character-queries"

// Degree helpers
export { getTargetDegree } from "./computer-degree"
