import { createReadStream } from 'fs'
import sax from 'sax'
import { open } from 'sqlite'
import sqlite3 from 'sqlite3'

const sql = String.raw

const highwayNodes = new Set<string>()
const nodes: string[][] = []
const ways: string[][] = []
const nodeways: string[][] = []
const tags: string[][] = []

type Context = {
    parent?: sax.Tag
    highway: boolean
}

const pipeline = async (opentag: (ctx: Context, e: sax.Tag) => void, closetag: (ctx: Context, e: string) => void) => {
    const fileStream = createReadStream('resource/planet_20.423,51.941_21.793,52.53.osm')
    // const fileStream = createReadStream('resource/planet_20.967,52.167_21.071,52.212.osm')
    const xmlStream = sax.createStream()

    const ctx: Context = { highway: false }
    let elements = 0
    xmlStream.on('opentag', e => opentag(ctx, e as sax.Tag))
    xmlStream.on('closetag', e => {
        closetag(ctx, e)
        elements++
        if (elements % 1_000_000 === 0) console.debug('progress', `${elements / 1_000_000}M`)
    })
    fileStream.pipe(xmlStream)
    await new Promise(done => xmlStream.on('end', done))
}

const db = await open({
    // filename: `resource/data_${new Date().getTime()}.db`,
    filename: `database.db`,
    driver: sqlite3.Database
})
await Promise.all(['Node', 'Way', 'NodeWay', 'Tag'].map(t => db.run(sql`drop table if exists ${t}`)))
await db.run(
    sql`create table Node (
        id TEXT UNIQUE NOT NULL,
        lon TEXT NOT NULL,
        lat TEXT NOT NULL
    )`
)
await db.run(
    sql`create table Way (
        id TEXT UNIQUE NOT NULL
    )`
)
await db.run(
    sql`create table NodeWay (
        nodeId TEXT NOT NULL,
        wayId TEXT NOT NULL
    )`
)
await db.run(
    sql`create table Tag (
        parentId TEXT NOT NULL,
        k TEXT NOT NULL,
        v TEXT NOT NULL
    )`
)

await pipeline(
    (ctx, e) => {
        switch (e.name) {
            case 'NODE':
            case 'RELATION':
            case 'WAY': {
                ctx.parent = e
                ctx.highway = false
                break
            }
            case 'ND': {
                if (ctx.parent?.name !== 'WAY') break
                const nodeId = e.attributes.REF
                nodeways.push([nodeId, ctx.parent!.attributes.ID])
                highwayNodes.add(nodeId)
                break
            }
            case 'TAG': {
                if (ctx.parent?.name !== 'WAY') break
                if (e.attributes.K === 'highway') ctx.highway = true
                tags.push([ctx.parent.attributes.ID, e.attributes.K, e.attributes.V])
                break
            }
        }
    },
    (ctx, e) => {
        if (e !== ctx.parent?.name) return
        const id = ctx.parent.attributes.ID as string
        switch (e) {
            case 'NODE': {
                nodes.push([id, ctx.parent.attributes.LON, ctx.parent.attributes.LAT])
                break
            }
            case 'WAY': {
                if (ctx.highway) ways.push([id])
                break
            }
        }
    }
)

console.debug({
    nodes: nodes.length,
    ways: ways.length,
    nodeways: nodeways.length,
    tags: tags.length
})
await db.run('begin')
console.debug('populating nodes')
let progress = 0
let stmt = await db.prepare(sql`insert into Node (id, lon, lat) values (?, ?, ?)`)
for (const node of nodes) {
    if (highwayNodes.has(node[0])) {
        await stmt.run(...node)
    }
    progress++
    if (progress % 1_000_000 === 0) console.debug('progress', `${progress / 1_000_000}M`)
}
console.debug('populating ways')
progress = 0
stmt = await db.prepare(sql`insert into Way (id) values (?)`)
for (const way of ways) {
    await stmt.run(...way)
    progress++
    if (progress % 1_000_000 === 0) console.debug('progress', `${progress / 1_000_000}M`)
}
console.debug('populating nodeways')
progress = 0
stmt = await db.prepare(sql`insert into NodeWay (nodeId, wayId) values (?, ?)`)
for (const nodeway of nodeways) {
    await stmt.run(...nodeway)
    progress++
    if (progress % 1_000_000 === 0) console.debug('progress', `${progress / 1_000_000}M`)
}
console.debug('populating tags')
progress = 0
stmt = await db.prepare(sql`insert into Tag (parentId, k, v) values (?, ?, ?)`)
for (const tag of tags) {
    await stmt.run(...tag)
    progress++
    if (progress % 1_000_000 === 0) console.debug('progress', `${progress / 1_000_000}M`)
}
await db.run('commit')

console.debug('creating indexes')
await db.run(sql`create index nodeWayNodeIdIdx on NodeWay(nodeId)`)
await db.run(sql`create index nodeWayWayIdIdx on NodeWay(wayId)`)
await db.run(sql`create index tagParentIdIdx on Tag(parentId)`)
