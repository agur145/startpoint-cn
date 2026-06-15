/**
 * Seed Validator — 抽卡种子四态自动验证系统
 *
 * 通过客户端 C3032 crash 回报逐步验证种子池，最终 100% 准确。
 *
 * 种子四态：
 *   UNKNOWN  — 从未发送过（初始态）
 *   PENDING  — 已发送但不够 3 次（次数不足，尚未确认）
 *   VERIFIED — 已发送 ≥VERIFY_THRESHOLD 次无 crash，99.9% 安全
 *   BLOCKED  — C3032 crash 回报，永久排除
 *
 * 优先级：UNKNOWN > PENDING(1x) > PENDING(2x) > VERIFIED > 跳过 BLOCKED
 *
 * 置信度（基于弹珠动画约 90% 触发概率）：
 *   3 次无 crash → 99.9%
 *   5 次无 crash → 99.999%
 *
 * 持久化：
 *   - blocked_seeds.json   — C3032 确认错误
 *   - verified_seeds.json  — 已确认安全
 *   - pending_seeds.json   — 发送次数（重启不丢失）
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ASSETS_DIR = join(__dirname, "..", "..", "assets");
const BLOCKED_FILE = join(ASSETS_DIR, "blocked_seeds.json");
const VERIFIED_FILE = join(ASSETS_DIR, "verified_seeds.json");
const PENDING_FILE = join(ASSETS_DIR, "pending_seeds.json");

/** 需要多少次无 crash 发送才能标记 VERIFIED */
const VERIFY_THRESHOLD = 3;

export class SeedValidator {
    private blocked: Set<number> = new Set();
    private verified: Set<number> = new Set();
    /** seed → 已发送次数 */
    private sendCount: Map<number, number> = new Map();

    constructor() {
        this.load();
    }

    // ========================================================================
    // 持久化
    // ========================================================================

    private load(): void {
        // blocked
        try {
            if (existsSync(BLOCKED_FILE)) {
                const data = JSON.parse(readFileSync(BLOCKED_FILE, "utf-8"));
                if (Array.isArray(data)) this.blocked = new Set(data);
                console.log(`[SEED] Loaded ${this.blocked.size} blocked seeds`);
            }
        } catch (e) {
            console.error(`[SEED] Failed to load blocked:`, (e as Error).message);
        }

        // verified
        try {
            if (existsSync(VERIFIED_FILE)) {
                const data = JSON.parse(readFileSync(VERIFIED_FILE, "utf-8"));
                if (Array.isArray(data)) this.verified = new Set(data);
                console.log(`[SEED] Loaded ${this.verified.size} verified seeds`);
            }
        } catch (e) {
            console.error(`[SEED] Failed to load verified:`, (e as Error).message);
        }

        // pending (send counts)
        try {
            if (existsSync(PENDING_FILE)) {
                const data = JSON.parse(readFileSync(PENDING_FILE, "utf-8"));
                if (typeof data === "object" && !Array.isArray(data)) {
                    for (const [seed, count] of Object.entries(data)) {
                        this.sendCount.set(Number(seed), count as number);
                    }
                }
                console.log(`[SEED] Loaded ${this.sendCount.size} pending seeds`);
            }
        } catch (e) {
            console.error(`[SEED] Failed to load pending:`, (e as Error).message);
        }
    }

    private saveBlocked(): void {
        writeFileSync(BLOCKED_FILE, JSON.stringify(Array.from(this.blocked).sort((a, b) => a - b), null, 2), "utf-8");
    }

    private saveVerified(): void {
        writeFileSync(VERIFIED_FILE, JSON.stringify(Array.from(this.verified).sort((a, b) => a - b), null, 2), "utf-8");
    }

    private savePending(): void {
        const obj: Record<string, number> = {};
        for (const [seed, count] of this.sendCount) {
            obj[String(seed)] = count;
        }
        writeFileSync(PENDING_FILE, JSON.stringify(obj, null, 2), "utf-8");
    }

    // ========================================================================
    // 核心操作
    // ========================================================================

    /**
     * 标记 seed 为 BLOCKED（C3032 crash 确认错误）。
     * 同时从 PENDING / VERIFIED 中移除。
     */
    blockSeed(seed: number): void {
        if (this.blocked.has(seed)) return;
        this.sendCount.delete(seed);
        this.verified.delete(seed);
        this.blocked.add(seed);
        this.saveBlocked();
        this.savePending();
        this.saveVerified();
        console.log(`[SEED] BLOCKED seed ${seed} (C3032)`);
    }

    /**
     * 标记 seed 已发送一次。
     * 累计发送 ≥VERIFY_THRESHOLD 次无 crash → 自动升为 VERIFIED。
     */
    markSent(seed: number): void {
        if (this.blocked.has(seed)) return;
        if (this.verified.has(seed)) return;

        const count = (this.sendCount.get(seed) || 0) + 1;
        this.sendCount.set(seed, count);
        this.savePending();

        if (count >= VERIFY_THRESHOLD) {
            this.sendCount.delete(seed);
            this.verified.add(seed);
            this.savePending();
            this.saveVerified();
            console.log(`[SEED] VERIFIED seed ${seed} (${count}x no crash)`);
        }
    }

    /** 查询 seed 的发送次数 */
    getSendCount(seed: number): number {
        return this.sendCount.get(seed) || 0;
    }

    // ========================================================================
    // 种子选取 — 优先级：UNKNOWN > PENDING > VERIFIED > 跳过 BLOCKED
    // ========================================================================

    /**
     * 从候选池中选一个安全的 seed。
     * 优先级：UNKNOWN > PENDING(1x) > PENDING(2x) > VERIFIED
     *
     * @param pool  候选种子数组
     * @param characterId  fallback 用
     */
    getSafeSeed(pool: number[], characterId: number): number {
        // 优先级 1: UNKNOWN
        const unknown = pool.filter(s =>
            !this.blocked.has(s) && !this.verified.has(s) && !this.sendCount.has(s)
        );
        if (unknown.length > 0) {
            return unknown[Math.floor(Math.random() * unknown.length)];
        }

        // 优先级 2: PENDING（按次数升序：先发 1 次的，再 2 次的）
        for (let targetCount = 1; targetCount < VERIFY_THRESHOLD; targetCount++) {
            const pending = pool.filter(s =>
                this.sendCount.get(s) === targetCount
            );
            if (pending.length > 0) {
                return pending[Math.floor(Math.random() * pending.length)];
            }
        }

        // 优先级 3: VERIFIED
        const safe = pool.filter(s => this.verified.has(s));
        if (safe.length > 0) {
            return safe[Math.floor(Math.random() * safe.length)];
        }

        // 全部 BLOCKED → fallback
        console.log(`[SEED] All seeds blocked for pool, using characterId fallback`);
        const fallback = characterId * 1000;
        if (!this.blocked.has(fallback)) return fallback;
        for (let offset = 0; offset < 10000; offset++) {
            const candidate = characterId * 1000 + offset;
            if (!this.blocked.has(candidate)) return candidate;
        }
        return characterId * 1000;
    }

    // ========================================================================
    // 统计
    // ========================================================================

    stats(): {
        blocked: number; verified: number;
        pending1: number; pending2: number; unknown: number;
    } {
        let pending1 = 0, pending2 = 0;
        for (const [, count] of this.sendCount) {
            if (count === 1) pending1++;
            else if (count === 2) pending2++;
        }
        return {
            blocked: this.blocked.size,
            verified: this.verified.size,
            pending1,
            pending2,
            unknown: 0,
        };
    }

    unblockSeed(seed: number): boolean {
        const had = this.blocked.delete(seed);
        if (had) {
            this.saveBlocked();
            this.verified.add(seed);
            this.saveVerified();
        }
        return had;
    }

    getBlockedList(): number[] {
        return Array.from(this.blocked).sort((a, b) => a - b);
    }

    getVerifiedList(): number[] {
        return Array.from(this.verified).sort((a, b) => a - b);
    }
}

const validator = new SeedValidator();
export default validator;
