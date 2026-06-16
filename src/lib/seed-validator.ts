/**
 * Seed Validator — 抽卡种子自动验证 + 惊险净化系统
 *
 * 通过客户端 C3032 crash 回报自动验证种子，有 device★ 数据的自动移入 PURIFIED。
 *
 * 种子状态：
 *   UNKNOWN  — 从未发送
 *   PENDING  — 已发送 1-2 次
 *   VERIFIED — ≥3 次无 crash
 *   BLOCKED  — C3032（有 device★ 数据等待净化）
 *   PURIFIED — 从 BLOCKED 按设备真值修复的惊险种子
 *
 * 池模式：
 *   unknown  — 测试池，优先 UNKNOWN 种子
 *   purified — 净化池，零 C3032，优先 PURIFIED + VERIFIED
 *
 * 优先级（测试池）: all | 3 | 4 | 5
 *
 * 持久化：
 *   blocked_seeds.json / verified_seeds.json / pending_seeds.json
 *   purified_seeds.json / device_seeds.json / pool_config.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ASSETS_DIR = join(__dirname, "..", "..", "assets");
const BLOCKED_FILE = join(ASSETS_DIR, "blocked_seeds.json");
const VERIFIED_FILE = join(ASSETS_DIR, "verified_seeds.json");
const PENDING_FILE = join(ASSETS_DIR, "pending_seeds.json");
const PURIFIED_FILE = join(ASSETS_DIR, "purified_seeds.json");
const DEVICE_FILE = join(ASSETS_DIR, "device_seeds.json");
const CONFIG_FILE = join(ASSETS_DIR, "pool_config.json");

const VERIFY_THRESHOLD = 3;

export type PoolMode = 'unknown' | 'purified';
export type TestPriority = 'all' | '3' | '4' | '5';

export class SeedValidator {
    private blocked: Set<number> = new Set();
    private verified: Set<number> = new Set();
    private sendCount: Map<number, number> = new Map();
    /** seed → correct rarity (0=★3, 1=★4, 2=★5) */
    private purified: Map<number, number> = new Map();
    /** seed → {ballRarity: 3|4|5, charRarity: 3|4|5} */
    private deviceData: Map<number, { ballRarity: number; charRarity: number }> = new Map();

    private mode: PoolMode = 'unknown';
    private priority: TestPriority = 'all';

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
                const arr = JSON.parse(readFileSync(BLOCKED_FILE, "utf-8"));
                if (Array.isArray(arr)) this.blocked = new Set(arr);
                console.log(`[SEED] Loaded ${this.blocked.size} blocked seeds`);
            }
        } catch (e) { console.error(`[SEED] blocked load:`, (e as Error).message); }

        // verified
        try {
            if (existsSync(VERIFIED_FILE)) {
                const arr = JSON.parse(readFileSync(VERIFIED_FILE, "utf-8"));
                if (Array.isArray(arr)) this.verified = new Set(arr);
                console.log(`[SEED] Loaded ${this.verified.size} verified seeds`);
            }
        } catch (e) { console.error(`[SEED] verified load:`, (e as Error).message); }

        // pending
        try {
            if (existsSync(PENDING_FILE)) {
                const obj = JSON.parse(readFileSync(PENDING_FILE, "utf-8"));
                for (const [k, v] of Object.entries(obj)) this.sendCount.set(Number(k), v as number);
                console.log(`[SEED] Loaded ${this.sendCount.size} pending seeds`);
            }
        } catch (e) { console.error(`[SEED] pending load:`, (e as Error).message); }

        // purified
        try {
            if (existsSync(PURIFIED_FILE)) {
                const obj = JSON.parse(readFileSync(PURIFIED_FILE, "utf-8"));
                for (const [k, v] of Object.entries(obj)) this.purified.set(Number(k), v as number);
                console.log(`[SEED] Loaded ${this.purified.size} purified seeds`);
            }
        } catch (e) { console.error(`[SEED] purified load:`, (e as Error).message); }

        // device data
        try {
            if (existsSync(DEVICE_FILE)) {
                const obj = JSON.parse(readFileSync(DEVICE_FILE, "utf-8"));
                for (const [k, v] of Object.entries(obj)) {
                    this.deviceData.set(Number(k), { ballRarity: v as number, charRarity: 0 });
                }
                console.log(`[SEED] Loaded ${this.deviceData.size} device data records`);
            }
        } catch (e) { console.error(`[SEED] device data load:`, (e as Error).message); }

        // pool config
        try {
            if (existsSync(CONFIG_FILE)) {
                const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
                if (cfg.mode) this.mode = cfg.mode;
                if (cfg.priority) this.priority = cfg.priority;
                console.log(`[SEED] Pool mode: ${this.mode}, priority: ${this.priority}`);
            }
        } catch (e) { console.error(`[SEED] config load:`, (e as Error).message); }
    }

    private saveFile(path: string, data: any): void {
        writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    }

    // ========================================================================
    // C3032 回调
    // ========================================================================

    recordDeviceData(seed: number, ballRarity: number, charRarity: number): void {
        this.deviceData.set(seed, { ballRarity, charRarity });
        this.saveFile(DEVICE_FILE, Object.fromEntries(
            Array.from(this.deviceData.entries()).map(([k, v]) => [k, v.ballRarity])
        ));
        console.log(`[SEED] Recorded device data seed ${seed}: ball★${ballRarity} char★${charRarity}`);
    }

    blockSeed(seed: number): void {
        if (this.blocked.has(seed)) return;
        this.sendCount.delete(seed);
        this.verified.delete(seed);
        this.blocked.add(seed);
        this.saveFile(BLOCKED_FILE, Array.from(this.blocked).sort((a, b) => a - b));
        this.saveFile(PENDING_FILE, Object.fromEntries(this.sendCount));
        this.saveFile(VERIFIED_FILE, Array.from(this.verified).sort((a, b) => a - b));
        console.log(`[SEED] BLOCKED seed ${seed} (C3032)`);
    }

    /** 自动净化：有 device★ 的 blocked → 移入 PURIFIED */
    autoPurify(): number {
        let count = 0;
        for (const seed of this.blocked) {
            const dd = this.deviceData.get(seed);
            if (dd) {
                const correctRarity = dd.ballRarity - 3; // ball★3→0, ★4→1, ★5→2
                this.purified.set(seed, correctRarity);
                this.blocked.delete(seed);
                count++;
                console.log(`[SEED] PURIFIED seed ${seed}: ★${dd.ballRarity} (was blocked, now purified★${dd.ballRarity})`);
            }
        }
        if (count > 0) {
            this.saveFile(PURIFIED_FILE, Object.fromEntries(this.purified));
            this.saveFile(BLOCKED_FILE, Array.from(this.blocked).sort((a, b) => a - b));
            console.log(`[SEED] autoPurify: ${count} seeds → PURIFIED`);
        }
        return count;
    }

    // ========================================================================
    // 发送计数
    // ========================================================================

    markSent(seed: number): void {
        if (this.blocked.has(seed)) return;
        if (this.verified.has(seed)) return;
        if (this.purified.has(seed)) return;

        const count = (this.sendCount.get(seed) || 0) + 1;
        this.sendCount.set(seed, count);
        this.saveFile(PENDING_FILE, Object.fromEntries(this.sendCount));

        if (count >= VERIFY_THRESHOLD) {
            this.sendCount.delete(seed);
            this.verified.add(seed);
            this.saveFile(PENDING_FILE, Object.fromEntries(this.sendCount));
            this.saveFile(VERIFIED_FILE, Array.from(this.verified).sort((a, b) => a - b));
            console.log(`[SEED] VERIFIED seed ${seed} (${count}x no crash)`);
        }
    }

    // ========================================================================
    // 池模式
    // ========================================================================

    getMode(): PoolMode { return this.mode; }
    getPriority(): TestPriority { return this.priority; }

    setMode(mode: PoolMode): void {
        this.mode = mode;
        this.saveFile(CONFIG_FILE, { mode: this.mode, priority: this.priority });
        console.log(`[SEED] Pool mode → ${mode}`);
    }

    setPriority(priority: TestPriority): void {
        this.priority = priority;
        this.saveFile(CONFIG_FILE, { mode: this.mode, priority: this.priority });
        console.log(`[SEED] Priority → ${priority}`);
    }

    // ========================================================================
    // 种子选取
    // ========================================================================

    /**
     * 按当前模式和优先级选种
     * @param rarity 角色稀有度 3-5
     * @param pool   该稀有度的候选种子数组
     * @param characterId fallback
     */
    getSeed(rarity: number, pool: number[], characterId: number): number {
        const rarityIdx = rarity - 3; // 0=★3, 1=★4, 2=★5

        if (this.mode === 'purified') {
            // 净化池：PURIFIED > VERIFIED
            const pur = pool.filter(s => this.purified.has(s) && this.purified.get(s) === rarityIdx);
            if (pur.length > 0) return pur[Math.floor(Math.random() * pur.length)];

            const ver = pool.filter(s => this.verified.has(s));
            if (ver.length > 0) return ver[Math.floor(Math.random() * ver.length)];

            const other = pool.filter(s => !this.blocked.has(s));
            if (other.length > 0) return other[Math.floor(Math.random() * other.length)];

            return characterId * 1000;
        }

        // 测试池：UNKNOWN > PENDING·1 > PENDING·2 > VERIFIED，可设置优先级
        // 优先级筛选
        const isTarget = (s: number) => {
            if (this.priority === 'all') return true;
            // 只在目标稀有度的 pool 中，pool 已经是筛选过的
            return true; // pool 已经按 rarity 筛选
        };

        // 若设置了优先级且当前 rarity 不匹配，跳过 PURIFIED/VERIFIED 优先
        const targetRarity = this.priority === 'all' ? null : parseInt(this.priority);

        // UNKNOWN
        const unknown = pool.filter(s =>
            !this.blocked.has(s) && !this.verified.has(s) && !this.sendCount.has(s) && !this.purified.has(s)
        );
        if (unknown.length > 0) return unknown[Math.floor(Math.random() * unknown.length)];

        // PENDING
        for (let tc = 1; tc < VERIFY_THRESHOLD; tc++) {
            const pending = pool.filter(s => this.sendCount.get(s) === tc);
            if (pending.length > 0) return pending[Math.floor(Math.random() * pending.length)];
        }

        // VERIFIED
        const ver = pool.filter(s => this.verified.has(s));
        if (ver.length > 0) return ver[Math.floor(Math.random() * ver.length)];

        // PURIFIED（测试池也兜底）
        const pur = pool.filter(s => this.purified.has(s) && this.purified.get(s) === rarityIdx);
        if (pur.length > 0) return pur[Math.floor(Math.random() * pur.length)];

        // fallback
        const fb = characterId * 1000;
        if (!this.blocked.has(fb)) return fb;
        for (let o = 0; o < 10000; o++) {
            const c = characterId * 1000 + o;
            if (!this.blocked.has(c)) return c;
        }
        return characterId * 1000;
    }

    // ========================================================================
    // 统计
    // ========================================================================

    stats() {
        let p1 = 0, p2 = 0;
        for (const [, c] of this.sendCount) { if (c === 1) p1++; else if (c === 2) p2++; }
        const purifiedStats = { r3: 0, r4: 0, r5: 0 };
        for (const [, r] of this.purified) { if (r === 0) purifiedStats.r3++; else if (r === 1) purifiedStats.r4++; else purifiedStats.r5++; }
        return {
            blocked: this.blocked.size, verified: this.verified.size,
            pending1: p1, pending2: p2, unknown: 0,
            purified_r3: purifiedStats.r3, purified_r4: purifiedStats.r4, purified_r5: purifiedStats.r5,
            purified_total: this.purified.size,
            mode: this.mode, priority: this.priority,
        };
    }

    // ========================================================================
    // 管理
    // ========================================================================

    unblockSeed(seed: number): boolean {
        const had = this.blocked.delete(seed);
        if (had) {
            this.saveFile(BLOCKED_FILE, Array.from(this.blocked).sort((a, b) => a - b));
            this.verified.add(seed);
            this.saveFile(VERIFIED_FILE, Array.from(this.verified).sort((a, b) => a - b));
        }
        return had;
    }

    getBlockedList(): number[] { return Array.from(this.blocked).sort((a, b) => a - b); }
    getVerifiedList(): number[] { return Array.from(this.verified).sort((a, b) => a - b); }
    getPurifiedList(): [number, number][] { return Array.from(this.purified.entries()).map(([s, r]) => [s, r + 3]); }
    getDeviceDataFor(seed: number): { ballRarity: number; charRarity: number } | undefined { return this.deviceData.get(seed); }
}

const validator = new SeedValidator();
export default validator;
