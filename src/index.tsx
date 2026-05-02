/* @refresh reload */

import { compareAsc } from 'date-fns/fp'
import { Position } from 'geojson'
import { Map } from 'maplibre-gl'
import { Component, onMount } from 'solid-js'
import { render } from 'solid-js/web'
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
        map.scrollZoom.enable()
        await new Promise(done => map.on('load', done))

        // map.on('move', () => console.debug(map.getCenter(), map.getZoom()))
        await Promise.all(
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
                console.debug(trackpoints)
                map.addLayer({
                    id: routeFile,
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
                                        coordinates: trackpoints.map(t => t.position)
                                    },
                                    properties: {}
                                }
                            ]
                        }
                    },
                    paint: {
                        'line-color': pathColors[Math.floor(hash(routeFile) % pathColors.length)],
                        'line-width': 1
                    }
                })
            })
        )
        const nodes: { lon: string; lat: string }[] = await (await fetch('/nodes')).json()
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
    })

    return (
        <>
            <div id="map" />
        </>
    )
}

render(() => <Main />, document.getElementById('root')!)
