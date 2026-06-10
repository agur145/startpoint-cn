import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import playerRoutePlugin from "./player"
import mailRoutePlugin from "./mail"
import { getServerDate } from "../../utils";
import { getAllAccountsSync, getAccountPlayersSync, getPlayerSync } from "../../data/wdfpData";
import { getActiveAccountId } from "../../data/activeAccount";

export const staticPagesDir = "../../../web/pages"

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (_: FastifyRequest, reply: FastifyReply) => {
        const currentServerTime = getServerDate().toISOString().replace(/\.\d\d\dZ/, "")
        let html = readFileSync(path.join(__dirname, staticPagesDir, "index.html")).toString("utf-8")

        // Time
        html = html.replace("{{currentServerTime}}", currentServerTime)

        // Active account info
        const activeId = getActiveAccountId()
        let activeInfo = ''
        if (activeId !== null) {
            const activePlayerIds = getAccountPlayersSync(activeId)
            const activePlayerId = activePlayerIds.length > 0 ? activePlayerIds[0] : null
            const activePlayer = activePlayerId ? getPlayerSync(activePlayerId) : null
            const name = activePlayer?.name || `Player${activeId}`
            activeInfo = `<p class="text-green-400">已绑定账号 ID=${activeId} (${name}) — 游戏将始终读取此账号</p>`
        } else {
            activeInfo = `<p class="text-yellow-400">未绑定 — 每次登录创建新账号</p>`
        }
        html = html.replace("{{activeInfo}}", activeInfo)

        // Account list
        const accounts = getAllAccountsSync()
        let accountRows = ''
        for (const acc of accounts) {
            const playerIds = getAccountPlayersSync(acc.id)
            const playerId = playerIds.length > 0 ? playerIds[0] : null
            const player = playerId ? getPlayerSync(playerId) : null
            const isActive = acc.id === activeId
            const displayName = player?.name || `Player${acc.id}`
            accountRows += `<tr class="${isActive ? 'bg-primary/10' : ''}">
                <td>${acc.id}</td>
                <td>${displayName}</td>
                <td>${player?.name || '-'}</td>
                <td>${acc.status}</td>
                <td>${acc.regTime.toISOString().split('T')[0]}</td>
                <td>
                    <form method="post" action="/api/server/activate?id=${acc.id}" style="display:inline">
                        <button type="submit" class="text-xs bg-primary text-on-primary px-2 py-1 rounded-full">${isActive ? '当前' : '切换'}</button>
                    </form>
                    <form method="post" action="/api/server/renameAccount" style="display:inline">
                        <input type="hidden" name="playerId" value="${playerId}">
                        <input type="text" name="name" placeholder="昵称" value="${displayName}" class="text-xs w-20 px-1 py-0.5 rounded border border-outline-variant">
                        <button type="submit" class="text-xs border border-outline-variant px-2 py-1 rounded-full">改名</button>
                    </form>
                    <form method="post" action="/api/server/deleteAccount?id=${acc.id}" style="display:inline" onsubmit="return confirm('删除账号 ${acc.id}？此操作不可撤销')">
                        <button type="submit" class="text-xs text-error px-2 py-1 rounded-full border border-error">删除</button>
                    </form>
                </td>
            </tr>`
        }
        html = html.replace("{{accountRows}}", accountRows || '<tr><td colspan="6" class="text-center text-on-surface-variant py-4">暂无账号</td></tr>')

        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(html)
    })

    fastify.register(playerRoutePlugin, { prefix: "/player" })
    fastify.register(mailRoutePlugin)
}

export default routes;
