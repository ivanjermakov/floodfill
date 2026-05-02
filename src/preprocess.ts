import { createReadStream } from 'fs'
import sax from 'sax'
import { open } from 'sqlite'
import sqlite3 from 'sqlite3'

const sql = String.raw

const pipeline = async (opentag: (ctx: { parent?: sax.Tag; nds: string[] }, e: sax.Tag) => void) => {
    // const fileStream = createReadStream('resource/planet_20.423,51.941_21.793,52.53.osm')
    const fileStream = createReadStream('resource/planet_20.967,52.167_21.071,52.212.osm')
    // const fileStream = createReadStream('resource/small.osm')
    const xmlStream = sax.createStream()

    const ctx = { nds: [] }
    let elements = 0
    xmlStream.on('opentag', e => {
        opentag(ctx, e as sax.Tag)
        elements++
        if (elements % 1_000_000 === 0) console.debug('progress', elements)
    })
    fileStream.pipe(xmlStream)
    await new Promise(done => xmlStream.on('end', done))
}

const db = await open({ filename: `resource/data_${new Date().getTime()}.db`, driver: sqlite3.Database })
await db.run(
    sql`create table Node (
        id TEXT UNIQUE NOT NULL,
        lon TEXT NOT NULL,
        lat TEXT NOT NULL
    )`
)
await db.run(
    sql`create table Way (
        id TEXT UNIQUE NOT NULL,
        highway TEXT
    )`
)
await db.run(
    sql`create table NodeWay (
        nodeId TEXT NOT NULL,
        wayId TEXT NOT NULL
    )`
)

type Result = {
    nodes: Record<string, { lon: string; lat: string } | null>
    ways: Record<string, { highway: string; nds: string[] }>
}

const result: Result = {
    nodes: {},
    ways: {}
}

await pipeline((ctx, e) => {
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
            ctx.nds.length = 0
            break
        }
        case 'ND': {
            if (ctx.parent?.name !== 'WAY') break
            ctx.nds.push(e.attributes.REF as string)
            break
        }
        case 'TAG': {
            if (ctx.parent?.name !== 'WAY') break
            if (e.attributes.K === 'highway') {
                for (const nd of ctx.nds) {
                    result.nodes[nd] = null
                }
                const id = ctx.parent.attributes.ID as string
                result.ways[id] = { highway: e.attributes.V, nds: ctx.nds }
            }
            break
        }
    }
})
console.debug('highway ways', Object.keys(result.ways).length)

await pipeline((_ctx, e) => {
    switch (e.name) {
        case 'NODE': {
            const id = e.attributes.ID as string
            if (result.nodes[id] === null) {
                result.nodes[id] = { lon: e.attributes.LON as string, lat: e.attributes.LAT as string }
            }
            break
        }
    }
})
console.debug('highway nodes', Object.keys(result.nodes).length)

console.debug('populating nodes')
await db.run('begin')
const nodeEntries = Object.entries(result.nodes)
for (const [nodeId, node] of nodeEntries) {
    if (node) {
        await db.run(sql`insert into Node (id, lon, lat) values (?, ?, ?)`, nodeId, node.lon, node.lat)
    }
}
await db.run('commit')

console.debug('populating ways')
await db.run('begin')
const wayEntries = Object.entries(result.ways)
for (const [wayId, way] of wayEntries) {
    await db.run(sql`insert into Way (id, highway) values (?, ?)`, wayId, way.highway)
}
await db.run('commit')

console.debug('populating nodeways')
await db.run('begin')
for (const [wayId, way] of wayEntries) {
    for (const node of way.nds) {
        if (node) await db.run(sql`insert into NodeWay (nodeId, wayId) values (?, ?)`, node, wayId)
    }
}
await db.run('commit')

console.debug('creating indexes')
await db.run(sql`create index nodeWayNodeIdIdx on NodeWay(nodeId)`)
await db.run(sql`create index nodeWayWayIdIdx on NodeWay(wayId)`)
