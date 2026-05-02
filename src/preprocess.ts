import { createReadStream } from 'fs'
import sax from 'sax'
import { open } from 'sqlite'
import sqlite3 from 'sqlite3'

const sql = String.raw

const nodes: string[][] = []
const ways: string[][] = []
const nodeways: string[][] = []
const tags: string[][] = []

const pipeline = async (
    opentag: (ctx: { parent?: sax.Tag; nds: string[] }, e: sax.Tag) => void,
    closetag: (ctx: { parent?: sax.Tag; nds: string[] }, e: string) => void
) => {
    // const fileStream = createReadStream('resource/planet_20.423,51.941_21.793,52.53.osm')
    const fileStream = createReadStream('resource/planet_20.967,52.167_21.071,52.212.osm')
    const xmlStream = sax.createStream()

    const ctx = { nds: [] }
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
            case 'NODE': {
                ctx.parent = e
                break
            }
            case 'RELATION': {
                ctx.parent = e
                break
            }
            case 'WAY': {
                ctx.parent = e
                ctx.nds = []
                break
            }
            case 'ND': {
                if (ctx.parent?.name !== 'WAY') break
                ctx.nds.push(e.attributes.REF as string)
                break
            }
            case 'TAG': {
                if (ctx.parent?.name !== 'WAY') break
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
                ways.push([id])
                for (const node of ctx.nds) {
                    nodeways.push([node, id])
                }
                break
            }
        }
    }
)

console.debug({ nodes: nodes.length, ways: nodeways.length, nodeways: nodeways.length, tags: tags.length })
await db.run('begin')
console.debug('populating nodes')
for (const node of nodes) {
    await db.run(sql`insert into Node (id, lon, lat) values (?, ?, ?)`, ...node)
}
console.debug('populating ways')
for (const way of ways) {
    await db.run(sql`insert into Way (id) values (?)`, ...way)
}
console.debug('populating nodeways')
for (const nodeway of nodeways) {
    await db.run(sql`insert into NodeWay (nodeId, wayId) values (?, ?)`, ...nodeway)
}
console.debug('populating tags')
for (const tag of tags) {
    await db.run(sql`insert into Tag (parentId, k, v) values (?, ?, ?)`, ...tag)
}
await db.run('commit')

console.debug('creating indexes')
await db.run(sql`create index nodeWayNodeIdIdx on NodeWay(nodeId)`)
await db.run(sql`create index nodeWayWayIdIdx on NodeWay(wayId)`)
await db.run(sql`create index tagParentIdIdx on Tag(parentId)`)
