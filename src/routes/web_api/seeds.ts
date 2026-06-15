import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import seedValidator from "../../lib/seed-validator";
import movieSeeds from "../../../assets/gacha_movie_seeds.json";

interface UnblockBody {
    seed: number;
}

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
        const known = s.verified + s.pending1 + s.pending2 + s.blocked;
        const unknown = totalSeeds - known;
        const safe = totalSeeds - s.blocked;
        reply.status(200).send({
            unknown,
            pending1: s.pending1,
            pending2: s.pending2,
            verified: s.verified,
            blocked: s.blocked,
            total: totalSeeds,
            safe,
            accuracy: totalSeeds > 0 ? Math.round(safe / totalSeeds * 100) : 0,
            /** 已发送过至少 1 次的种子（覆盖率） */
            tested: known - s.blocked,
            coverage: totalSeeds > 0 ? Math.round(known / totalSeeds * 100) : 0,
        });
    });

    fastify.get("/list", async (_request: FastifyRequest, reply: FastifyReply) => {
        const blocked = seedValidator.getBlockedList();
        const verified = seedValidator.getVerifiedList();
        reply.status(200).send({ blocked, verified });
    });

    fastify.post("/unblock", async (request: FastifyRequest, reply: FastifyReply) => {
        const { seed } = request.body as UnblockBody;
        if (typeof seed !== "number" || isNaN(seed)) {
            return reply.status(400).send({ error: "Invalid seed" });
        }
        const removed = seedValidator.unblockSeed(seed);
        reply.status(200).send({ seed, removed });
    });
};

export default routes;
