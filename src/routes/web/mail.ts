import { FastifyInstance } from "fastify"
import { readFileSync } from "fs"
import path from "path"
import { staticPagesDir } from "./index"

const routes = async (fastify: FastifyInstance) => {
    const template = readFileSync(path.join(__dirname, staticPagesDir, "mail.html"), "utf-8")

    fastify.get("/mail", async (_request, reply) => {
        reply.header("content-type", "text/html; charset=utf-8")
        reply.status(200).send(template)
    })
}

export default routes
