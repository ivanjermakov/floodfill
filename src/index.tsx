/* @refresh reload */

import { compareAsc, differenceInSeconds } from 'date-fns'
import { Position } from 'geojson'
import { Map } from 'maplibre-gl'
import { Component, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import { distanceHaversine } from './geo'
import './index.css'

const pathColors = [
    '#7fb069',
    '#f5b700',
    '#00a1e4',
    '#dab6fc',
    '#fd3e81',
    '#7cfef0',
    '#5aa9e6',
    '#cb48b7',
    '#e3170a',
    '#fabc2a'
]

const hash = (str: string) => {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) + hash + str.charCodeAt(i)
    }
    return hash >>> 0
}

type Track = {
    name: string
    timestamp: string
    points: Trackpoint[]
    filtered: Trackpoint[]
    /**
     * Seconds
     */
    duration?: number
    distance: number
    elevation: { asc: number; desc: number }
}

type Trackpoint = {
    position: Position
    timestamp?: string
}

// TODO: server
const gpxs = ['20260430-181917.gpx']

const Main: Component = () => {
    onMount(async () => {
        const map = new Map({
            container: 'map',
            style: 'map/ofm-dark.json',
            attributionControl: false,
            // center: [21, 52.23],
            // zoom: 11
            center: [21.02, 52.19],
            zoom: 13
        })
        // map.dragRotate.disable()
        // map.keyboard.disable()
        // map.touchZoomRotate.disableRotation()
        // map.on('move', () => console.debug(map.getCenter(), map.getZoom()))
        map.scrollZoom.enable()
        await new Promise(done => map.on('load', done))

        // const nodes: { lon: string; lat: string }[] = await (await fetch('/nodes')).json()
        const nodes: { lon: string; lat: string }[] = await (await fetch('/nodes.json')).json()
        console.debug(nodes)
        map.addLayer({
            id: 'nodes',
            type: 'circle',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [
                        {
                            type: 'Feature',
                            geometry: {
                                type: 'MultiPoint',
                                coordinates: nodes.map(n => [Number.parseFloat(n.lon), Number.parseFloat(n.lat)])
                            },
                            properties: {}
                        }
                    ]
                }
            },
            paint: {
                'circle-radius': 3,
                'circle-color': '#555555'
            }
        })

        const tracks: Track[] = await Promise.all(
            gpxs.map(async routeFile => {
                const gpxRaw = await (await fetch(`gpx/${routeFile}`)).text()
                const parser = new DOMParser()
                const gpx = parser.parseFromString(gpxRaw, 'text/xml')
                const readNumAttr = (e: Element, name: string) =>
                    Number.parseFloat(e.attributes.getNamedItem(name)!.value)
                const readNumChild = (e: Element, name: string) => {
                    const raw = e.getElementsByTagName(name).item(0)?.innerHTML
                    if (raw) return Number.parseFloat(raw)
                    return undefined
                }
                // https://github.com/timfraedrich/OutRun/issues/96
                const trksegs = gpx.getElementsByTagName('trkseg')
                const trkseg = trksegs.item(trksegs.length - 1)!
                const trackpoints: Trackpoint[] = [...trkseg.getElementsByTagName('trkpt')].map(point => {
                    const trackpoint = {
                        position: [readNumAttr(point, 'lon'), readNumAttr(point, 'lat')],
                        timestamp: point.getElementsByTagName('time').item(0)?.innerHTML ?? undefined
                    }
                    const elevation = readNumChild(point, 'ele')
                    if (elevation !== undefined) trackpoint.position.push(elevation)
                    return trackpoint
                })
                trackpoints.sort((a, b) => compareAsc(a.timestamp ?? '', b.timestamp ?? ''))

                const filtered: Trackpoint[] = []
                const position = trackpoints[0].position
                for (const point of trackpoints) {
                    const p = point.position
                    const k = 0.2
                    position[0] = position[0] * (1 - k) + p[0] * k
                    position[1] = position[1] * (1 - k) + p[1] * k

                    if (position.length > 2 !== undefined) {
                        // since altitude changes are less volatile, apply heavier filtering
                        const k = 0.1
                        position[2] = position[2] * (1 - k) + p[2] * k
                    }
                    filtered.push({ position: [...position], timestamp: point.timestamp })
                }

                const timeStart = trackpoints.at(0)?.timestamp
                const timeEnd = trackpoints.at(-1)?.timestamp
                let distance = 0
                const elevation = { asc: 0, desc: 0 }
                for (let i = 0; i < filtered.length - 1; i++) {
                    const a = filtered[i].position
                    const b = filtered[i + 1].position
                    distance += distanceHaversine(a[1], a[0], b[1], b[0])

                    if (b.length > 2 !== undefined) {
                        if (a[2] < b[2]) {
                            elevation.asc += b[2] - a[2]
                        } else {
                            elevation.desc += a[2] - b[2]
                        }
                    }
                }
                const track: Track = {
                    name: routeFile,
                    timestamp:
                        trackpoints[0].timestamp ??
                        gpx.getElementsByTagName('time').item(0)?.innerHTML ??
                        new Date().toISOString(),
                    points: trackpoints,
                    filtered,
                    duration: timeStart && timeEnd ? differenceInSeconds(timeEnd, timeStart) : undefined,
                    distance,
                    elevation
                }
                return track
            })
        )
        console.debug(tracks)
        await Promise.all(
            tracks.map(async track => {
                map.addLayer({
                    id: track.name,
                    type: 'line',
                    source: {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: [
                                {
                                    type: 'Feature',
                                    geometry: {
                                        type: 'LineString',
                                        coordinates: track.filtered.map(t => t.position)
                                    },
                                    properties: {}
                                }
                            ]
                        }
                    },
                    paint: {
                        'line-color': pathColors[Math.floor(hash(track.name) % pathColors.length)],
                        'line-width': 2
                    }
                })
            })
        )
    })

    return (
        <>
            <div id="map" />
        </>
    )
}

render(() => <Main />, document.getElementById('root')!)
