// Multi battle TCP session server
// Protocol: JSON messages delimited by null byte (\0)
// Post-handshake messages use typepacker format with useEnumIndex=true:
//   [index, param1, param2, ...]
//
// Enum indices:
//   MeetingServer2Client: Message=1, Messages=2, Error=0
//   MeetingServerMessage: Home=0, Mates=1, StateChanged=2, Start=5, AckHeartbeat=10
//   MeetingNotifyMessage: Enter=0, Bye=1, ChangeParty=2, Ready=3, Heartbeat=4,
//                          StartBattle=5, Suspend=6, ChangeAutoplayMode=7, ...
//   Client2Server: Notify=0, Broadcast=1, Send=2
//   ReadyState: Preparation=0, Ready=1
//   HandshakeResult: Accept=0, Denied=1, Reconnect=2, Exception=3, Complete=4

import * as net from "net";
import { MultiRoom } from "../lib/types";
import { disbandRoom } from "./multiRoom";

interface SessionClient {
    socket: net.Socket;
    viewerId: number;
    roomNumber: string;
    isReady: boolean;
    buffer: string;
    mates: any[];
}

const clients = new Map<string, SessionClient>();
const roomClients = new Map<string, Set<string>>();

let server: net.Server | null = null;
const SESSION_PORT = parseInt(process.env.SESSION_PORT || "8003");
const SESSION_HOST = process.env.SESSION_HOST || "0.0.0.0";

function getAddress(client: SessionClient): string {
    return `${client.viewerId}@${client.roomNumber}`;
}

function addClient(client: SessionClient) {
    const addr = getAddress(client);
    clients.set(addr, client);

    let set = roomClients.get(client.roomNumber);
    if (!set) {
        set = new Set();
        roomClients.set(client.roomNumber, set);
    }
    set.add(addr);
}

function removeClient(client: SessionClient) {
    const addr = getAddress(client);
    clients.delete(addr);

    const set = roomClients.get(client.roomNumber);
    if (set) {
        set.delete(addr);
        if (set.size === 0) {
            roomClients.delete(client.roomNumber);
            disbandRoom(client.roomNumber);
            console.log(`[SESSION] room ${client.roomNumber} disbanded (all clients disconnected)`);
        }
    }
}

function sendJson(socket: net.Socket, obj: any) {
    const json = JSON.stringify(obj);
    socket.write(json + "\0");
    console.log(`[SESSION] sent to ${(socket as any).remoteAddress}:${(socket as any).remotePort}:`, json.substring(0, 150));
}

function broadcastToRoom(roomNumber: string, msg: any, exclude?: net.Socket) {
    const set = roomClients.get(roomNumber);
    if (!set) return;
    for (const addr of set) {
        const client = clients.get(addr);
        if (client && client.socket !== exclude) {
            sendJson(client.socket, msg);
        }
    }
}

function handleMessage(client: SessionClient, data: string) {
    try {
        const msg = JSON.parse(data);
        console.log(`[SESSION] recv from viewer=${client.viewerId}: ${data.substring(0, 150)}`);

        if (Array.isArray(msg)) {
            handleClient2Server(client, msg);
            return;
        }

        console.log(`[SESSION] unknown message:`, data.substring(0, 100));
    } catch (e) {
        console.log(`[SESSION] parse error:`, (e as Error).message, data.substring(0, 100));
    }
}

function handleClient2Server(client: SessionClient, msg: any[]) {
    const tag = msg[0];
    // Client2Server: Notify=0, Broadcast=1, Send=2
    switch (tag) {
        case 0: // Notify
            if (msg.length > 1 && Array.isArray(msg[1])) {
                handleNotify(client, msg[1]);
            }
            break;
        case 1: // Broadcast
            console.log(`[SESSION] Broadcast from viewer=${client.viewerId}`);
            break;
        case 2: // Send
            console.log(`[SESSION] Send from viewer=${client.viewerId}`);
            break;
        default:
            console.log(`[SESSION] unhandled Client2Server: ${tag}`);
    }
}

function handleNotify(client: SessionClient, msg: any[]) {
    const tag = msg[0];
    // MeetingNotifyMessage indices
    switch (tag) {
        case 0: // Enter
            console.log(`[SESSION] client ${client.viewerId} entered room ${client.roomNumber}`);
            break;

        case 4: // Heartbeat
            sendJson(client.socket, [1, [10, String(client.viewerId)]]);
            break;

        case 2: // ChangeParty
            console.log(`[SESSION] client ${client.viewerId} changed party`);
            break;

        case 3: // Ready
            client.isReady = true;
            broadcastToRoom(client.roomNumber, [1, [2, String(client.viewerId), [1]]]);
            break;

        case 1: // Bye
            console.log(`[SESSION] client ${client.viewerId} leaving room ${client.roomNumber}`);
            disconnectClient(client);
            break;

        case 6: // Suspend
            console.log(`[SESSION] client ${client.viewerId} suspended`);
            break;

        case 5: // StartBattle
            console.log(`[SESSION] client ${client.viewerId} requesting start`);
            sendJson(client.socket, [1, [5, client.mates]]);
            console.log(`[SESSION] started battle for room ${client.roomNumber}`);
            break;

        default:
            console.log(`[SESSION] unhandled Notify: ${tag}`, JSON.stringify(msg).substring(0, 100));
    }
}

function disconnectClient(client: SessionClient) {
    removeClient(client);
    try { client.socket.destroy(); } catch (e) {}
}

export function startSessionServer(): Promise<void> {
    return new Promise((resolve) => {
        server = net.createServer((socket) => {
            const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
            console.log(`[SESSION] new connection from ${remoteAddr}`);

            let buffer = "";
            let handledHandshake = false;
            let sessionClient: SessionClient | null = null;

            socket.on("data", (chunk: Buffer) => {
                buffer += chunk.toString("utf-8");

                // Process null-delimited messages
                while (buffer.includes("\0")) {
                    const idx = buffer.indexOf("\0");
                    const data = buffer.substring(0, idx);
                    buffer = buffer.substring(idx + 1);

                    if (data.trim().length === 0) continue;

                    if (!handledHandshake) {
                        // First message is the handshake
                        handleHandshake(socket, data, remoteAddr).then((client) => {
                            sessionClient = client;
                            handledHandshake = true;
                        }).catch((err) => {
                            console.log(`[SESSION] handshake failed from ${remoteAddr}:`, err);
                            socket.destroy();
                        });
                    } else if (sessionClient) {
                        handleMessage(sessionClient, data);
                    }
                }
            });

            socket.on("close", () => {
                console.log(`[SESSION] disconnect from ${remoteAddr}`);
                if (sessionClient) {
                    removeClient(sessionClient);
                }
            });

            socket.on("error", (err) => {
                console.log(`[SESSION] socket error from ${remoteAddr}:`, err.message);
                if (sessionClient) {
                    removeClient(sessionClient);
                }
            });
        });

        server.listen(SESSION_PORT, SESSION_HOST, () => {
            console.log(`[SESSION] TCP session server listening on ${SESSION_HOST}:${SESSION_PORT}`);
            resolve();
        });
    });
}

export function stopSessionServer(): Promise<void> {
    return new Promise((resolve) => {
        if (server) {
            clients.clear();
            roomClients.clear();
            server.close(() => resolve());
        } else {
            resolve();
        }
    });
}

async function handleHandshake(socket: net.Socket, data: string, remoteAddr: string): Promise<SessionClient> {
    console.log(`[SESSION] handshake from ${remoteAddr}:`, data);

    let handshake: any;
    try {
        handshake = JSON.parse(data);
    } catch {
        throw new Error("Invalid handshake JSON");
    }

    const viewerId = handshake.viewerId;
    const roomNumber = handshake.roomNumber;

    if (!viewerId || !roomNumber) {
        throw new Error("Missing viewerId or roomNumber in handshake");
    }

    const client: SessionClient = {
        socket,
        viewerId: Number(viewerId),
        roomNumber: String(roomNumber),
        isReady: false,
        buffer: "",
        mates: []
    };

    addClient(client);

    // Send Accept response - array format [index, params...]
    sendJson(socket, [0, roomNumber, ""]);

    // Send Welcome + Mates after delay to ensure handshake listener
    // has been replaced with socket_received on client side
    // Fields use Option format: [0, value] = Some, [1] = None
    function makeChar(id: number): any[] {
        return [0, {
            id, evolution_level: 0, exp: 0, over_limit_step: 0,
            mana_node_ids: [1], ex_boost: [1], illustration_settings: [1]
        }];
    }
    function makeEquip(eid: number): any[] {
        return [0, { equipmentId: eid, level: 1, enhancementLevel: 0 }];
    }
    function makeParty(chars: number[], unisons: number[], equips: number[]): any {
        return {
            characters: chars.map(makeChar),
            unison_characters: unisons.map(makeChar),
            equipments: equips.map(makeEquip),
            abilitySoulIds: [[1], [1], [1]]
        };
    }

    const yourself = {
        viewerId: Number(viewerId),
        name: "Player" + viewerId,
        isHost: true,
        rank: 1,
        degreeId: 1,
        autoplayMode: false,
        currentPartyId: 1,
        state: [1],
        party: makeParty([131012,141007,151001], [141005,121002,131004], [200005,1010001,2020001])
    };
    const comMate1 = {
        viewerId: -1, comId: 1, name: "NPC助手1",
        isHost: false, rank: 80, degreeId: 1,
        autoplayMode: false, currentPartyId: 1, state: [1],
        party: makeParty([131012,141007,151001], [141005,121002,131004], [200005,1010001,2020001])
    };
    const comMate2 = {
        viewerId: -2, comId: 2, name: "NPC助手2",
        isHost: false, rank: 80, degreeId: 2000,
        autoplayMode: false, currentPartyId: 1, state: [1],
        party: makeParty([141004,121002,161001], [151001,141005,131004], [200005,1010001,2020001])
    };
    const mates = [yourself, comMate1, comMate2];
    client.mates = mates;

    setTimeout(() => {
        sendJson(socket, [1, [0, yourself, mates]]);
    }, 800);
    setTimeout(() => {
        sendJson(socket, [1, [1, mates]]);
    }, 1100);

    return client;
}

export { SESSION_PORT, SESSION_HOST };
