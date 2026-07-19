import { utc } from '@date-fns/utc'
import { addSeconds } from 'date-fns/addSeconds'
import { compareAsc } from 'date-fns/compareAsc'
import { differenceInSeconds } from 'date-fns/differenceInSeconds'
import { formatISO } from 'date-fns/formatISO'
import sax from 'sax'
import { Track, Trackpoint } from './api'
import { distanceHaversine } from './geo'
import { elevationAt } from './geotiff'

/**
 * Elevation discrepancy after which rely on GPS data only (bridges/tunnels)
 */
export const elevationThreshold = 5
export const averageSpeedWindowSeconds = 60

export const parseGpx = async (filename: string, data: string): Promise<Track> => {
    const stream = sax.createStream()
    const trackpoints: Trackpoint[] = []
    let currentPoint: Trackpoint | undefined
    let name: string | undefined
    const tag = {
        ele: false,
        time: false,
        name: false
    }

    stream.on('opentag', node => {
        if (node.name === 'NAME') {
            tag.name = true
        } else if (node.name === 'TRKPT') {
            currentPoint = {
                position: [
                    Number.parseFloat(node.attributes.LON as string),
                    Number.parseFloat(node.attributes.LAT as string)
                ],
                distance: 0,
                timestamp: undefined!
            }
        } else if (currentPoint) {
            if (node.name === 'ELE') tag.ele = true
            if (node.name === 'TIME') tag.time = true
        }
    })
    stream.on('text', text => {
        if (tag.name) {
            name = text
            tag.name = false
        }
        if (!currentPoint) return
        if (tag.ele) {
            currentPoint.position[2] = Number.parseFloat(text.trim())
            tag.ele = false
        }
        if (tag.time) {
            currentPoint.timestamp = text
            tag.time = false
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

    trackpoints.sort((a, b) => compareAsc(a.timestamp, b.timestamp))

    let i = 0
    let timestamp = trackpoints[0].timestamp
    const timestampLast = trackpoints.at(-1)!.timestamp
    while (timestamp !== timestampLast) {
        const tp = trackpoints[i]
        const cmp = compareAsc(timestamp, tp.timestamp)
        switch (cmp) {
            case -1:
                const dup = { ...tp, timestamp }
                trackpoints.splice(i, 0, dup)
                timestamp = formatISO(addSeconds(timestamp, 1), { in: utc })
                i++
                break
            case 0:
                timestamp = formatISO(addSeconds(timestamp, 1), { in: utc })
                i++
                break
            case 1:
                // when GPX has trackpoints with duplicate timestamp
                trackpoints.splice(i, 1)
                break
        }
    }

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
        const k = 0.8
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

    const timeStart = trackpoints.at(0)!.timestamp
    const timeEnd = trackpoints.at(-1)!.timestamp
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

        if (i === 0) filtered[i].speed = 0
        const delta = differenceInSeconds(filtered[i + 1].timestamp, filtered[i].timestamp)
        filtered[i + 1].speed = delta === 0 ? filtered[i].speed : (d / delta) * 3.6
        const k = 0.5
        filtered[i + 1].speed = (1 - k) * filtered[i].speed! + k * filtered[i + 1].speed!
    }
    console.log('track name', name)
    const track: Track = {
        name: name ?? filename.replace(/\.gpx$/, ''),
        timestamp: trackpoints[0].timestamp,
        points: trackpoints,
        filtered,
        duration: differenceInSeconds(timeEnd, timeStart),
        distance,
        elevation
    }
    return track
}
