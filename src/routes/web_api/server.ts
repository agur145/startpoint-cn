import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getServerTime, getServerDate, setServerTime, getTimeOffset } from "../../utils";
import { saveTimeOffset } from "../../data/activeAccount";
import { getAllAccountsSync, getAccountPlayersSync, getPlayerSync, getPlayerCharactersSync, deletePlayerSync, deleteAccountSync, updatePlayerSync, insertAccount, insertDefaultPlayerSync, insertSessionWithToken } from "../../data/wdfpData";
import { getActiveAccountId, setActiveAccountId } from "../../data/activeAccount";

interface TimeQuery {
    time: string | undefined
}

const routes = async (fastify: FastifyInstance) => {

    fastify.get("/currentTime", async (_request: FastifyRequest, reply: FastifyReply) => {
        const date = getServerDate()
        reply.status(200).send({
            servertime: getServerTime(),
            date: date.toISOString(),
            isCustom: date.getTime() !== Date.now()
        })
    })

    fastify.get("/resetTime", async (_request: FastifyRequest, reply: FastifyReply) => {
        setServerTime(null)
        saveTimeOffset(null)
        reply.status(200).send({
            servertime: getServerTime(),
            date: getServerDate().toISOString(),
            isCustom: false
        })
    })

    fastify.get("/time", async (request: FastifyRequest, reply: FastifyReply) => {
        const newTime = (request.query as TimeQuery).time
        if (!newTime) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Missing 'time' parameter. Use format: 2025-06-01T12:00:00"
        })

        try {
            let dateStr = newTime
            if (!dateStr.includes('T')) {
                dateStr = dateStr + 'T00:00:00'
            }
            if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
                dateStr = dateStr + 'Z'
            }
            const time = new Date(dateStr)
            if (isNaN(time.getTime())) {
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Invalid time format: "${newTime}". Use ISO format.`
                })
            }
            setServerTime(time)
            saveTimeOffset(getTimeOffset());
            reply.status(200).send({
                servertime: getServerTime(),
                date: getServerDate().toISOString(),
                isCustom: true
            })
        } catch (error: any) {
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": error?.message ?? "Unknown error"
            })
        }
    })

    // === Account management endpoints ===

    // List all accounts with player info
    fastify.get("/accounts", async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
            const accounts = getAllAccountsSync()
            const result = accounts.map(acc => {
                const playerIds = getAccountPlayersSync(acc.id)
                const playerId = playerIds.length > 0 ? playerIds[0] : null
                const player = playerId ? getPlayerSync(playerId) : null
                const characterCount = playerId ? Object.keys(getPlayerCharactersSync(playerId)).length : 0
                return {
                    id: acc.id,
                    status: acc.status,
                    regTime: acc.regTime.toISOString(),
                    lastLoginTime: acc.lastLoginTime.toISOString(),
                    displayName: player?.name || `Player${acc.id}`,
                    playerName: player?.name || '-',
                    playerId: playerId,
                    characterCount: characterCount
                }
            })
            reply.status(200).send(result)
        } catch (error: any) {
            return reply.status(500).send({ error: error?.message ?? "Unknown error" })
        }
    })

    // Get current active account info
    fastify.get("/activeAccount", async (_request: FastifyRequest, reply: FastifyReply) => {
        const activeId = getActiveAccountId()
        if (activeId === null) {
            return reply.status(200).send({ active: false, accountId: null, displayName: null })
        }
        const playerIds = getAccountPlayersSync(activeId)
        const playerId = playerIds.length > 0 ? playerIds[0] : null
        const player = playerId ? getPlayerSync(playerId) : null
        return reply.status(200).send({
            active: true,
            accountId: activeId,
            displayName: player?.name || `Player${activeId}`
        })
    })

    // Activate an account (set as current)
    fastify.post("/activate", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = (request.query || {}) as any
        const accountId = parseInt(id)
        if (isNaN(accountId)) return reply.status(400).send({ error: "Missing or invalid 'id'" })
        setActiveAccountId(accountId)
        return reply.redirect('/')
    })

    // Deactivate (return to create-new-account mode)
    fastify.post("/deactivate", async (_request: FastifyRequest, reply: FastifyReply) => {
        setActiveAccountId(null)
        return reply.redirect('/')
    })

    // Rename a player (changes the in-game name)
    fastify.post("/renameAccount", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Record<string, any> || {}
        const playerId = parseInt(body.playerId)
        const name = body.name
        if (isNaN(playerId) || !name) return reply.status(400).send({ error: "Missing 'playerId' or 'name'" })
        updatePlayerSync({ id: playerId, name: String(name) })
        return reply.redirect('/')
    })

    // Delete an account and its players
    fastify.post("/deleteAccount", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = (request.query || {}) as any
        const accountId = parseInt(id)
        if (isNaN(accountId)) return reply.status(400).send({ error: "Missing or invalid 'id'" })

        // Delete all players under this account
        const playerIds = getAccountPlayersSync(accountId)
        for (const pid of playerIds) {
            deletePlayerSync(pid)
        }
        deleteAccountSync(accountId)

        // If deleted account was active, clear it
        if (getActiveAccountId() === accountId) {
            setActiveAccountId(null)
        }
        return reply.redirect('/')
    })

    fastify.post("/newAccount", async (_request: FastifyRequest, reply: FastifyReply) => {
        const account = await insertAccount({
            appId: "wf_cn",
            idpAlias: "leiting_web",
            idpCode: "leiting",
            idpId: String(Date.now()),
            status: "normal"
        })
        insertDefaultPlayerSync(account.id)
        await insertSessionWithToken({
            accountId: account.id,
            token: String(account.id),
            type: 2, // SessionType.VIEWER
            expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        })
        setActiveAccountId(account.id)
        return reply.redirect('/')
    })
}

export default routes;
