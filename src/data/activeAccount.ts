/**
 * 活跃账号状态管理 + 时间偏移持久化
 * 用于 Web 面板切换不同存档，取值为 account_id 或 null（每次新建）
 * 状态持久化到 .database/active_account.json
 */
import * as fs from "fs";
import * as path from "path";
import { setServerTimeOffset } from "../utils";
import { getAllAccountsSync } from "./wdfpData";

const STATE_FILE = path.join(__dirname, "..", "..", ".database", "active_account.json");

interface AccountState {
    activeAccountId: number | null;
    giftIndex: number;
    timeOffset: number | null;
    lastSetTime: string | null;
}

function readState(): AccountState {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
            return {
                activeAccountId: raw.activeAccountId ?? null,
                giftIndex: raw.giftIndex ?? 0,
                timeOffset: raw.timeOffset ?? null,
                lastSetTime: raw.lastSetTime ?? null,
            };
        }
    } catch { /* ignore corrupt file */ }
    return { activeAccountId: null, giftIndex: 0, timeOffset: null, lastSetTime: null };
}

function writeState(state: AccountState): void {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

export function getActiveAccountId(): number | null {
    return readState().activeAccountId;
}

export function setActiveAccountId(id: number | null): void {
    const state = readState();
    state.activeAccountId = id;
    writeState(state);
}

/**
 * Save the current time offset for persistence across restarts.
 */
export function saveTimeOffset(offset: number | null): void {
    const state = readState();
    state.timeOffset = offset;
    state.lastSetTime = offset !== null ? new Date(Date.now() + offset).toISOString() : null;
    writeState(state);
}

/**
 * Restore the saved time offset on server startup.
 */
export function restoreTimeOffset(): void {
    const state = readState();
    if (state.timeOffset !== null) {
        setServerTimeOffset(state.timeOffset);
    }
}

/**
 * Rotate to the next account and return its ID.
 * Cycles through all available accounts.
 * Returns null if no accounts exist.
 */
export function rotateToNextAccount(): number | null {
    const accounts = getAllAccountsSync();
    if (accounts.length === 0) return null;

    const state = readState();
    state.giftIndex = (state.giftIndex + 1) % accounts.length;
    const nextAccount = accounts[state.giftIndex];
    state.activeAccountId = nextAccount.id;
    writeState(state);

    return nextAccount.id;
}
