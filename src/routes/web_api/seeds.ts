import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import seedValidator, { PoolMode, TestPriority } from "../../lib/seed-validator";
import movieSeeds from "../../../assets/gacha_movie_seeds.json";

interface UnblockBody { seed: number; }
interface ModeBody { mode: PoolMode; priority: TestPriority; }

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/stats", async (_request: FastifyRequest, reply: FastifyReply) => {
        const s = seedValidator.stats();
        let totalSeeds = 0;
        for (const key of Object.keys(movieSeeds)) {
            const types = (movieSeeds as any)[key];
            for (const mt of Object.keys(types)) {
                totalSeeds += (types[mt] as number[]).length;
            }
        }
        const known = s.verified + s.pending1 + s.pending2 + s.blocked + s.purified_total;
        reply.status(200).send({
            unknown: totalSeeds - known, pending1: s.pending1, pending2: s.pending2,
            verified: s.verified, blocked: s.blocked,
            purified_r3: s.purified_r3, purified_r4: s.purified_r4, purified_r5: s.purified_r5,
            purified_total: s.purified_total,
            mode: s.mode, priority: s.priority,
            total: totalSeeds, safe: totalSeeds - s.blocked,
            accuracy: totalSeeds > 0 ? Math.round((totalSeeds - s.blocked) / totalSeeds * 100) : 0,
            tested: known - s.blocked,
            coverage: totalSeeds > 0 ? Math.round(known / totalSeeds * 100) : 0,
        });
    });

    fastify.get("/list", async (_request: FastifyRequest, reply: FastifyReply) => {
        const blocked = seedValidator.getBlockedList().map(s => {
            const dd = seedValidator.getDeviceDataFor(s);
            return { seed: s, device: dd ? `★${dd.ballRarity}` : null, char: dd ? `★${dd.charRarity}` : null };
        });
        const verified = seedValidator.getVerifiedList();
        const purified = seedValidator.getPurifiedList().map(([s, r]) => ({ seed: s, rarity: r }));
        reply.status(200).send({ blocked, verified, purified });
    });

    fastify.post("/unblock", async (request: FastifyRequest, reply: FastifyReply) => {
        const { seed } = request.body as UnblockBody;
        if (typeof seed !== "number" || isNaN(seed)) return reply.status(400).send({ error: "Invalid seed" });
        const removed = seedValidator.unblockSeed(seed);
        reply.status(200).send({ seed, removed });
    });

    fastify.post("/mode", async (request: FastifyRequest, reply: FastifyReply) => {
        const { mode, priority } = request.body as ModeBody;
        if (mode && ['unknown', 'purified'].includes(mode)) seedValidator.setMode(mode);
        if (priority && ['all', '3', '4', '5'].includes(priority)) seedValidator.setPriority(priority);
        reply.status(200).send({ mode: seedValidator.getMode(), priority: seedValidator.getPriority() });
    });
};

export default routes;
