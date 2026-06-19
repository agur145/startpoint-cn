// Handles payment (IAP) endpoints.
// Private server: accepts any valid request, no real payment validation.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerSync, getSession, updatePlayerSync } from "../../data/wdfpData";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders } from "../../utils";
import { getConfigSync } from "../../lib/assets";
import paymentProducts from "../../../assets/payment_products.json";

interface PaymentProduct {
    store_product_id: string
    charge_vmoney_num: number
    free_vmoney_num: number
    display_name: string
    description: string
}

const PRODUCTS: Record<string, PaymentProduct> = paymentProducts as Record<string, PaymentProduct>

// In-memory purchase tracking (resets on server restart)
const purchaseHistory: Record<string, number> = {}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/item_list", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { api_count: number, viewer_id: number }
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const itemList = Object.values(PRODUCTS).map(p => ({
            store_product_id: p.store_product_id,
            charge_vmoney_num: p.charge_vmoney_num,
            free_vmoney_num: p.free_vmoney_num,
            display_name: p.display_name,
            description: p.description
        }))

        console.log(`[PAYMENT] item_list: ${itemList.length} products for viewer ${viewerId}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": { "payment_item_list": itemList }
        })
    })

    fastify.post("/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, product_id: string, api_count: number }
        const viewerId = body.viewer_id
        const productId = body.product_id

        if (!viewerId || isNaN(viewerId) || !productId) {
            console.warn(`[PAYMENT-START] invalid request`)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const product = PRODUCTS[productId]
        if (!product) {
            console.warn(`[PAYMENT-START] unknown product: ${productId}`)
            return reply.status(400).send({ "error": "Bad Request", "message": "Unknown product." })
        }

        console.log(`[PAYMENT-START] viewer ${viewerId}, product: ${productId} (paid=${product.charge_vmoney_num} free=${product.free_vmoney_num})`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        })
    })

    fastify.post("/finish", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            viewer_id: number
            product_id: string
            receipt: string
            signature?: string
            api_count: number
        }
        const viewerId = body.viewer_id
        const productId = body.product_id

        if (!viewerId || isNaN(viewerId) || !productId) {
            console.warn(`[PAYMENT-FINISH] invalid request`)
            return reply.status(400).send({ "error": "Bad Request", "message": "Invalid request body." })
        }

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (!playerId) return reply.status(500).send({ "error": "Internal Server Error", "message": "No player bound to account." })

        const player = getPlayerSync(playerId)
        if (!player) return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." })

        const product = PRODUCTS[productId]
        if (!product) {
            console.warn(`[PAYMENT-FINISH] unknown product: ${productId}`)
            return reply.status(400).send({ "error": "Bad Request", "message": "Unknown product." })
        }

        const paidVmoney = Math.max(0, isFinite(product.charge_vmoney_num) ? product.charge_vmoney_num : 0)
        const freeVmoney = Math.max(0, isFinite(product.free_vmoney_num) ? product.free_vmoney_num : 0)

        if (paidVmoney === 0 && freeVmoney === 0) {
            console.warn(`[PAYMENT-FINISH] product ${productId} has zero vmoney`)
        }

        const config = getConfigSync()
        const maxVmoney = config.max_virtual_money
        const afterPaid = Math.min(player.vmoney + paidVmoney, maxVmoney)
        const afterFree = Math.min(player.freeVmoney + freeVmoney, maxVmoney)

        updatePlayerSync({
            id: playerId,
            vmoney: afterPaid,
            freeVmoney: afterFree
        })

        // Track purchase count per player+product
        const purchaseKey = `${playerId}_${productId}`
        const times = (purchaseHistory[purchaseKey] ?? 0) + 1
        purchaseHistory[purchaseKey] = times

        console.log(`[PAYMENT-FINISH] player ${playerId}: paid ${player.vmoney}->${afterPaid} (+${paidVmoney}), free ${player.freeVmoney}->${afterFree} (+${freeVmoney}), product: ${productId}, times: ${times}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "after_vmoney": afterPaid,
                "after_free_vmoney": afterFree,
                "first_payment": times === 1,
                "purchased_times_list": { [productId]: times },
                "monthly_payment_total": 0
            }
        })
    })
}

export default routes
