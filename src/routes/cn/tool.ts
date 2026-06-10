import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders } from "../../utils";
import { insertAccount, insertDefaultPlayerSync, getAccountPlayers, getPlayerSync, getAccount, insertSessionWithToken, updateAccountSync, deleteSession } from "../../data/wdfpData";
import { SessionType } from "../../data/types";
import { getActiveAccountId, setActiveAccountId } from "../../data/activeAccount";

interface CnSignupBody {
    device_id: number;
    channelNo: string;
    media?: string;
    androidId?: string;
    oaid?: string;
    mac?: string;
    terminInfo?: string;
    osVer?: string;
    storage_directory_path?: string;
    first_viewer_id?: number;
    advertise_id?: string;
}

function generateLoginToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
        token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
}

const viewerIdToAccountId = new Map<number, number>();

interface GetHeaderResponseBody {
    viewer_id: number
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_header_response", (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetHeaderResponseBody;
        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: body.viewer_id
            }),
            "data": []
        });
    });

    fastify.post("/auth", async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            data_headers: generateDataHeaders(),
            data: {}
        });
    });

    fastify.post("/signup", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CnSignupBody;
        const udid = request.headers["udid"] as string || "unknown";
        const shortUdid = 0;

        const loginToken = generateLoginToken();

        let accountId: number;
        let newAccount: boolean = true;

        const firstViewerId = body.first_viewer_id ? Number(body.first_viewer_id) : null;
        const activeId = getActiveAccountId();

        // Priority: Web panel activeAccount > client first_viewer_id > new account
        if (activeId !== null) {
            const existingAccount = await getAccount(activeId);
            if (existingAccount && existingAccount.status === 'normal') {
                accountId = existingAccount.id;
                newAccount = false;
                updateAccountSync({ id: accountId, lastLoginTime: new Date() });
                try { deleteSession(String(accountId)); } catch (_) {}
            } else if (existingAccount) {
                // Account exists but banned/abnormal — reject login
                return reply.status(403).send({
                    error: "Account unavailable",
                    message: `Account ${activeId} has been ${existingAccount.status}.`
                });
            } else {
                // Active account doesn't exist — create replacement
                const account = await insertAccount({
                    appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal"
                });
                accountId = account.id;
                insertDefaultPlayerSync(accountId);
                setActiveAccountId(accountId);
            }
        } else if (firstViewerId !== null) {
            const existingAccount = await getAccount(firstViewerId);
            if (existingAccount && existingAccount.status === 'normal') {
                accountId = existingAccount.id;
                newAccount = false;
                updateAccountSync({ id: accountId, lastLoginTime: new Date() });
                try { deleteSession(String(accountId)); } catch (_) {}
            } else if (existingAccount) {
                // Account exists but banned/abnormal — reject login, don't auto-create
                return reply.status(403).send({
                    error: "Account unavailable",
                    message: `Account ${firstViewerId} has been ${existingAccount.status}.`
                });
            } else {
                // Old account not found — create new
                const account = await insertAccount({
                    appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal"
                });
                accountId = account.id;
                insertDefaultPlayerSync(accountId);
                setActiveAccountId(accountId);
            }
        } else {
            // First launch — create new account
            const account = await insertAccount({
                appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal"
            });
            accountId = account.id;
            insertDefaultPlayerSync(accountId);
            setActiveAccountId(accountId);
        }

        await insertSessionWithToken({
            token: String(accountId),
            accountId: accountId,
            type: SessionType.VIEWER,
            expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        });

        viewerIdToAccountId.set(accountId, accountId);

        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            data_headers: generateDataHeaders({
                viewer_id: accountId,
                short_udid: shortUdid,
                udid: udid,
            }),
            data: {
                login_token: loginToken,
                newAccount: newAccount ? 1 : 0,
                roleName: `Player${accountId}`,
                accountName: `Player${accountId}`,
                sign: "dummy_sign",
                createDate: new Date().toISOString(),
                serverName: "StarPoint CN",
                serverId: 1,
            }
        });
    });
};

export default routes;
