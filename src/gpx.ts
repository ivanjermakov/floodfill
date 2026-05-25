import { compareAsc, differenceInSeconds } from 'date-fns'
import sax from 'sax'
import { Track, Trackpoint } from './api'
import { distanceHaversine } from './geo'
import { elevationAt } from './geotiff'

/**
 * Elevation discrepancy after which rely on GPS data only (bridges/tunnels)
 */
const elevationThreshold = 5

export const parseGpx = async (name: string, data: string): Promise<Track> => {
    const stream = sax.createStream()
    const trackpoints: Trackpoint[] = []
    let currentPoint: Trackpoint | undefined
    let ele = false
    let time = false

    stream.on('opentag', node => {
        if (node.name === 'TRKPT') {
            currentPoint = {
                position: [
                    Number.parseFloat(node.attributes.LON as string),
                    Number.parseFloat(node.attributes.LAT as string)
                ],
                distance: 0
            }
        } else if (currentPoint) {
            if (node.name === 'ELE') ele = true
            if (node.name === 'TIME') time = true
        }
    })
    stream.on('text', text => {
        if (!currentPoint) return
        if (ele) {
            currentPoint.position[2] = Number.parseFloat(text.trim())
            ele = false
        }
        if (time) {
            currentPoint.timestamp = text
            time = false
        }
    })
    stream.on('closetag', name => {
        if (name === 'TRKPT') {
            trackpoints.push(currentPoint!)
            currentPoint = undefined
        }
    })
    stream.write(data)
    stream.end()

    trackpoints.sort((a, b) => compareAsc(a.timestamp ?? '', b.timestamp ?? ''))

    for (const tp of trackpoints) {
        const e = await elevationAt(tp.position[0], tp.position[1])
        if (e !== undefined) {
            if (tp.position.length === 2 || Math.abs(tp.position[2] - e) < elevationThreshold) {
                tp.position[2] = e
            }
        }
    }

    const filtered: Trackpoint[] = []
    const position = trackpoints[0].position
    for (const point of trackpoints) {
        const p = point.position
        const k = 0.5
        position[0] = position[0] * (1 - k) + p[0] * k
        position[1] = position[1] * (1 - k) + p[1] * k
        const kEle = 0.05
        if (p.length > 2) position[2] = position[2] * (1 - kEle) + p[2] * kEle

        const f: Trackpoint = {
            position: [...position],
            distance: point.distance,
            timestamp: point.timestamp
        }
        filtered.push(f)
    }

    const timeStart = trackpoints.at(0)?.timestamp
    const timeEnd = trackpoints.at(-1)?.timestamp
    let distance = 0
    const elevation = { asc: 0, desc: 0 }
    for (let i = 0; i < filtered.length - 1; i++) {
        const a = filtered[i].position
        const b = filtered[i + 1].position
        const d = distanceHaversine(a[1], a[0], b[1], b[0])
        distance += d
        filtered[i + 1].distance = distance

        if (b.length > 2 !== undefined) {
            if (a[2] < b[2]) {
                elevation.asc += b[2] - a[2]
            } else {
                elevation.desc += a[2] - b[2]
            }
        }

        if (filtered[i].timestamp && filtered[i + 1].timestamp) {
            if (i === 0) filtered[i].speed = 0
            const delta = differenceInSeconds(filtered[i + 1].timestamp!, filtered[i].timestamp!)
            filtered[i + 1].speed = delta === 0 ? filtered[i].speed : (d / delta) * 3.6
            const k = 0.5
            filtered[i + 1].speed = (1 - k) * filtered[i].speed! + k * filtered[i + 1].speed!
        }
    }
    const track: Track = {
        name: name.replace(/\.gpx$/, ''),
        timestamp: trackpoints[0].timestamp ?? new Date().toISOString(),
        points: trackpoints,
        filtered,
        duration: timeStart && timeEnd ? differenceInSeconds(timeEnd, timeStart) : undefined,
        distance,
        elevation
    }
    return track
}
