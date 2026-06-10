import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import path from "path";
import { staticPagesDir } from ".";
import { getAllPlayersSync, getPlayerSync, getPlayerCharactersSync, getPlayerItemsSync, getPlayerEquipmentListSync } from "../../data/wdfpData";

interface GetPlayerParams {
    playerId: string | undefined
}

interface GetPlayerQuery {
    error: string | undefined
}

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
        let html = readFileSync(path.join(__dirname, staticPagesDir, "players.html")).toString("utf-8")

        const players = getAllPlayersSync()
        
        let listContent = ''
        if (players.length === 0) {
            listContent = `<h4 class="text-xl w-full text-center font-bold">No players found</h4>
            <h4 class="text-xl w-full text-center font-bold">Connect to Starpoint with a client and sign in as a guest</h4>`
        } else {
            for (const player of players) {
                const id = player.id
                listContent += `<li class="w-full">
                    <a href="/player/${id}"
                        class="p-5 h-full text-on-surface hover:text-primary items-center flex gap-3 border-outline-variant transition-colors border rounded-3xl hover:bg-surface-container-low">
                        <section class="flex flex-col gap-2 flex-1">
                            <h4 class="text-xl font-bold text-inherit transition-colors">${player.name}</h4>
                            <h4 class="text-base font-bold text-on-surface-variant">Last Login: ${player.lastLoginTime.toDateString()}</h4>
                        </section>
                        
                        <section class="flex gap-3 items-center">
                            <p class="text-xl text-on-surface-variant w-full">Player Id</p>
                            <h4 class="text-xl font-bold text-inherit transition-colors">${id}</h4>
                        </section>
                    </a>
                </li>`
            }  
        }

        html = html.replace("{{listContent}}", listContent)

        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(html)
    })

    fastify.get("/:playerId", async (request: FastifyRequest, reply: FastifyReply) => {
        const { playerId } = request.params as GetPlayerParams
        const { error } = request.query as GetPlayerQuery
        const parsedPlayerId = Number(playerId)
        if (isNaN(parsedPlayerId)) return reply.redirect("/player");

        const player = getPlayerSync(parsedPlayerId)
        if (player === null) return reply.redirect("/player");

        let html = readFileSync(path.join(__dirname, staticPagesDir, "player.html")).toString("utf-8")

        // Basic info
        html = html.replace(/{{playerName}}/g, player.name)
            .replace(/{{playerComment}}/g, player.comment)
            .replace(/{{playerId}}/g, String(parsedPlayerId))
            .replace("{{uploadError}}", error === undefined ? '' : `<h3 class="text-xl text-error font-semibold mt-2">${error}</h3>`);

        // Resource fields
        const resourceFields = [
            { key: 'freeVmoney', label: '星导石(免费)', value: player.freeVmoney },
            { key: 'vmoney', label: '星导石(付费)', value: player.vmoney },
            { key: 'freeMana', label: 'Mana(免费)', value: player.freeMana },
            { key: 'paidMana', label: 'Mana(付费)', value: player.paidMana },
            { key: 'stamina', label: '体力', value: player.stamina },
            { key: 'rankPoint', label: 'Rank', value: player.rankPoint },
            { key: 'starCrumb', label: '星屑', value: player.starCrumb },
            { key: 'bondToken', label: '羁绊证', value: player.bondToken },
            { key: 'bossBoostPoint', label: 'Boss Boost', value: player.bossBoostPoint },
            { key: 'boostPoint', label: 'Boost', value: player.boostPoint },
        ];
        let resourcesHtml = '';
        for (const f of resourceFields) {
            resourcesHtml += `<div><label class="text-xs text-on-surface-variant">${f.label}</label>
                <input class="bg-surface-container rounded border border-outline-variant p-1 w-24 text-sm" value="${f.value}" onchange="editField('${f.key}', this.value)"></div>`;
        }
        html = html.replace("{{resources}}", resourcesHtml);

        // Character list
        const characters = getPlayerCharactersSync(parsedPlayerId);
        let charsHtml = '';
        for (const [code, char] of Object.entries(characters)) {
            charsHtml += `<tr>
                <td class="p-1">${code}</td>
                <td class="p-1">${char.evolutionLevel}</td>
                <td class="p-1">${char.exp}</td>
                <td class="p-1">${char.entryCount}</td>
                <td class="p-1"><button onclick="delChar('${code}')" class="text-xs text-error border border-error rounded-full px-2">✕</button></td>
            </tr>`;
        }
        html = html.replace("{{characterRows}}", charsHtml || '<tr><td colspan="5" class="text-on-surface-variant p-2">暂无角色</td></tr>');
        html = html.replace("{{characterCount}}", String(Object.keys(characters).length));

        // Items
        const items = getPlayerItemsSync(parsedPlayerId);
        let itemsHtml = '';
        for (const [itemId, count] of Object.entries(items)) {
            itemsHtml += `<tr>
                <td class="p-1">${itemId}</td>
                <td class="p-1">${count}</td>
                <td class="p-1"><button onclick="delItem('${itemId}')" class="text-xs text-error border border-error rounded-full px-2">✕</button></td>
            </tr>`;
        }
        html = html.replace("{{itemRows}}", itemsHtml || '<tr><td colspan="3" class="text-on-surface-variant p-2">暂无道具</td></tr>');

        // Equipment
        const equipment = getPlayerEquipmentListSync(parsedPlayerId);
        let equipHtml = '';
        for (const [eqId, eq] of Object.entries(equipment)) {
            equipHtml += `<tr>
                <td class="p-1">${eqId}</td>
                <td class="p-1">${eq.level}</td>
                <td class="p-1">${eq.enhancementLevel}</td>
            </tr>`;
        }
        html = html.replace("{{equipRows}}", equipHtml || '<tr><td colspan="3" class="text-on-surface-variant p-2">暂无装备</td></tr>');

        // Account settings
        html = html.replace("{{tutorialStep}}", String(player.tutorialStep ?? ''));
        html = html.replace("{{tutorialSkip}}", player.tutorialSkipFlag === true ? 'checked' : '');
        html = html.replace("{{auto3x}}", player.enableAuto3x ? 'checked' : '');
        html = html.replace("{{birth}}", String(player.birth));
        html = html.replace("{{degreeId}}", String(player.degreeId));

        reply.header("content-type", "text/html; charset=utf-8")
        reply.send(html)
    })
}

export default routes;
