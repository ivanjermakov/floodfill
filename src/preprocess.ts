import { createReadStream } from 'fs'
import { writeFile } from 'fs/promises'
import sax from 'sax'

const pipeline = async (opentag: (e: sax.Tag) => void) => {
    const fileStream = createReadStream('resource/planet_20.423,51.941_21.793,52.53.osm')
    // const fileStream = createReadStream('resource/small.osm')
    const xmlStream = sax.createStream()
    xmlStream.on('opentag', opentag)
    fileStream.pipe(xmlStream)
    await new Promise(done => xmlStream.on('end', done))
}

const result: Record<string, string[] | null> = {}
let elements = 0
const current = {
    parent: undefined! as sax.Tag,
    nds: [] as string[]
}

await pipeline((e: sax.Tag) => {
    switch (e.name) {
        case 'NODE': {
            current.parent = e
            break
        }
        case 'RELATION': {
            current.parent = e
            break
        }
        case 'WAY': {
            current.parent = e
            current.nds.length = 0
            break
        }
        case 'ND': {
            if (current.parent.name !== 'WAY') break
            current.nds.push(e.attributes.REF as string)
            break
        }
        case 'TAG': {
            if (current.parent.name !== 'WAY') break
            if (e.attributes.K === 'highway') {
                for (const nd of current.nds) {
                    result[nd] = null
                }
            }
            break
        }
    }
    elements++
    if (elements % 100000 === 0) console.debug('progress', elements)
})
console.debug('highway nodes', Object.keys(result).length)

await pipeline((e: sax.Tag) => {
    switch (e.name) {
        case 'NODE': {
            const id = e.attributes.ID as string
            if (result[id] === null) {
                result[id] = [e.attributes.LON as string, e.attributes.LAT as string]
            }
            break
        }
    }
    elements++
    if (elements % 100000 === 0) console.debug('progress', elements)
})

await writeFile('resource/highway.json', JSON.stringify(result))
