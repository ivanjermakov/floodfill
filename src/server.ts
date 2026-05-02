import { createReadStream } from 'fs'
import { IncomingMessage, ServerResponse, createServer } from 'http'
import { extname, join, normalize } from 'path'
import { stat } from 'fs/promises'
import { exit } from 'process'
import { db, initDb, sql } from './db'
import { debug, error, info, request } from './log'

const streamFile = (filePath: string, res: ServerResponse): void => {
    const ext = extname(filePath).toLowerCase()
    const ctype = contentType[ext] ?? contentType['.txt']
    res.setHeader('Content-Type', ctype)
    const stream = createReadStream(filePath)
    stream.on('error', () => {
        res.statusCode = 500
        res.end('Server error')
    })
    stream.pipe(res)
}

const contentType: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
}

const body = (req: IncomingMessage): Promise<ArrayBuffer> => {
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', () => resolve(joinBuffers(chunks)))
        req.on('error', reject)
    })
}

const joinBuffers = (buffers: Buffer[]): ArrayBuffer => {
    const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const buf of buffers) {
        result.set(buf, offset)
        offset += buf.byteLength
    }
    return result.buffer
}

const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    request(req)
    const host = req.headers.host ?? 'localhost'
    const rawUrl = `http://${host}${req.url ?? '/'}`
    const url = new URL(rawUrl)

    if (url.pathname === '/nodes') {
        const raw = await db.all(sql`
select n.lat, n.lon
    from NodeWay nw
    join (
        select * from Way w
        where
            (exists(
                select 1 from Tag t
                where t.parentId = w.id and (t.k = 'highway' AND t.v = 'cycleway')
                limit 1
            ) and not exists(
                select 1 from Tag t
                where t.parentId = w.id and (t.k = 'cycleway' and t.v = 'crossing')
                limit 1
            ))
            or
            (exists(
                select 1 from Tag t
                where t.parentId = w.id and t.k = 'highway' and t.v = 'path'
                limit 1
            ) and exists(
                select 1 from Tag t
                where t.parentId = w.id and (t.k = 'bicycle' and t.v = 'designated')
                limit 1
            ) and not exists(
                select 1 from Tag t
                where t.parentId = w.id and (t.k = 'cycleway' and t.v = 'crossing')
                limit 1
            ))
    ) w on w.id = nw.wayId
    join Node n on n.id = nw.nodeId
;`)
        res.setHeader('Content-Type', contentType['.json'])
        res.write(JSON.stringify(raw))
        res.statusCode = 200
        res.end()
        return
    }

    if (await tryServeFile(url.pathname, res)) {
        return
    }

    if (url.pathname === '/' && (await tryServeFile('/', res))) {
        return
    }

    res.statusCode = 404
    res.end()
}

const tryServeFile = async (url: string | undefined, res: ServerResponse): Promise<boolean> => {
    try {
        let urlPath = decodeURIComponent(url ?? '/')
        if (urlPath === '/') urlPath = '/index.html'
        const truePath = normalize(join(distPath, urlPath))
        if (!truePath.startsWith(normalize(`${distPath}/`))) return false

        const stats = await stat(truePath)
        if (stats.isFile()) {
            streamFile(truePath, res)
            return true
        }
    } catch (e) {}
    return false
}

let deinitizlized = false
const deinit = async (): Promise<void> => {
    if (deinitizlized) return
    deinitizlized = true
    debug('deinitializing')

    await new Promise<void>((resolve, reject) =>
        server.listening ? server.close(e => (e ? reject(e) : resolve())) : resolve()
    )
    await db.close()
    info('deinitialized')
    exit(0)
}

const distPath = process.env.FLOODFILL_DIST!
if (!distPath) {
    error('no dist path')
    exit(1)
}
process.on('SIGINT', deinit)
process.on('SIGTERM', deinit)

await initDb()

const server = createServer((req, res) => {
    handleRequest(req, res).catch(e => {
        error('request error', e)
        res.statusCode = 500
        res.end('Server error')
    })
})

const port = Number.parseInt(process.env.FLOODFILL_PORT ?? '3000')
server.listen(port, () => {
    info(`server started :${port}`)
})
