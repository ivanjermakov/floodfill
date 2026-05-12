/* @refresh reload */

import { Selection, axisBottom, axisLeft, axisRight, extent, line, max, min, scaleLinear, scaleTime, select } from 'd3'
import { compareAsc, compareDesc, differenceInSeconds, format } from 'date-fns'
import { Position } from 'geojson'
import { GeoJSONSource, Map } from 'maplibre-gl'
import { Component, For, Show, createEffect, createSignal, onMount } from 'solid-js'
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
    /**
     * kph
     */
    speed?: number
}

// TODO: server
const gpxs = ['20260430-181917.gpx', '20260507-185410.gpx', '20260510-160805.gpx', '20260511-184017.gpx']

const movingSpeedThreshold = 4

let map!: Map

const [$windowSize, setWindowSize] = createSignal<{ width: number; height: number }>()
const [$tracks, setTracks] = createSignal<Track[]>([])
const [$trackActive, setTrackActive] = createSignal<Track | undefined>()
let chartSvg!: SVGSVGElement
const chartMargin = { top: 0, right: 30, bottom: 20, left: 30 }
const [$trackpointActive, setTrackpointActive] = createSignal<Trackpoint | undefined>()

const Main: Component = () => {
    onMount(async () => {
        window.addEventListener('resize', () => setWindowSize({ width: window.innerWidth, height: window.innerHeight }))
        map = new Map({
            container: 'map',
            style: 'map/dark-matter.json',
            attributionControl: false,
            center: [21, 52.23],
            zoom: 11
            // center: [21.02, 52.19],
            // zoom: 13
        })
        // map.dragRotate.disable()
        // map.keyboard.disable()
        // map.touchZoomRotate.disableRotation()
        // map.on('move', () => console.debug(map.getCenter(), map.getZoom()))
        map.scrollZoom.enable()
        await new Promise(done => map.on('load', done))

        // const nodes: { lon: string; lat: string }[] = await (await fetch('/nodes')).json()
        const nodes: [string, string][][] = await (await fetch('/nodes.json')).json()
        console.debug(nodes)
        map.addLayer({
            id: 'nodes',
            type: 'line',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [
                        {
                            type: 'Feature',
                            geometry: {
                                type: 'MultiLineString',
                                coordinates: nodes.map(g =>
                                    g.map(n => [Number.parseFloat(n[1]), Number.parseFloat(n[0])])
                                )
                            },
                            properties: {}
                        }
                    ]
                }
            },
            paint: {
                'line-color': '#774444',
                'line-width': 2
            }
        })

        const tracks: Track[] = await Promise.all(
            gpxs.map(async trackFile => {
                const gpxRaw = await (await fetch(`gpx/${trackFile}`)).text()
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
                        const k = 0.05
                        position[2] = position[2] * (1 - k) + p[2] * k
                    }
                    const f: Trackpoint = { position: [...position], timestamp: point.timestamp }
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

                    // TODO: read elevation from topo map
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
                        const k = 0.2
                        filtered[i + 1].speed = (1 - k) * filtered[i].speed! + k * filtered[i + 1].speed!
                    }
                }
                const track: Track = {
                    name: trackFile,
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

        tracks.sort((a, b) => compareDesc(a.timestamp, b.timestamp))
        setTracks(tracks)
        // setTrackActive(tracks[0])
        console.debug(tracks)
    })

    createEffect(() => {
        $windowSize()
        const trackActive = $trackActive()
        const tracks = $tracks()

        tracks
            .filter(track => map.getLayer(track.name))
            .forEach(track =>
                map.setLayoutProperty(
                    track.name,
                    'visibility',
                    trackActive === undefined || track.name === trackActive.name ? 'visible' : 'none'
                )
            )

        if (!trackActive) return

        const width = chartSvg.clientWidth
        const height = chartSvg.clientHeight

        chartSvg.addEventListener('mousemove', e =>
            setTrackpointActive(
                trackActive.filtered.at(
                    Math.floor(
                        ((e.offsetX - chartMargin.left) / (width - chartMargin.left - chartMargin.right)) *
                            trackActive.filtered.length
                    )
                )
            )
        )
        chartSvg.addEventListener('mouseleave', () => setTrackpointActive(undefined))

        const chart = select(chartSvg)
        const elevationData = trackActive.filtered.map(p => ({ date: new Date(p.timestamp!), value: p.position[2] }))
        const xScale = scaleTime()
            .domain(extent(elevationData, d => d.date) as [Date, Date])
            .range([0, width - chartMargin.left - chartMargin.right])

        const elevationScale = scaleLinear()
            .domain([min(elevationData, d => d.value)!, max(elevationData, d => d.value)!])
            .range([height - chartMargin.top - chartMargin.bottom, 0])
        const elevationLine = line<{ date: Date; value: number }>()
            .x(d => xScale(d.date))
            .y(d => elevationScale(d.value))

        chart.selectChildren().remove()
        chart
            .append('g')
            .attr('transform', `translate(${chartMargin.left},${height - chartMargin.bottom})`)
            .call(
                axisBottom(xScale)
                    .tickFormat(d => format(d as Date, 'HH:mm'))
                    .ticks(20)
            )

        chart
            .append('path')
            .datum(elevationData)
            .attr('fill', 'none')
            .attr('stroke', pathColors[0])
            .attr('stroke-width', 2)
            .attr('transform', `translate(${chartMargin.left},${chartMargin.top})`)
            .attr('d', elevationLine)
        chart
            .append('g')
            .attr('transform', `translate(${chartMargin.left}, ${chartMargin.top})`)
            .call(axisLeft(elevationScale).ticks(height / 30))

        if (trackActive.filtered[0].speed !== undefined) {
            const speedData = trackActive.filtered.map(p => ({
                date: new Date(p.timestamp!),
                value: p.speed!
            }))
            const speedScale = scaleLinear()
                .domain([0, Math.min(50, max(speedData, d => d.value)!)])
                .range([height - chartMargin.top - chartMargin.bottom, 0])
            const speedLine = line<{ date: Date; value: number }>()
                .x(d => xScale(d.date))
                .y(d => speedScale(d.value))
            chart
                .append('path')
                .datum(speedData)
                .attr('fill', 'none')
                .attr('stroke', pathColors[1])
                .attr('stroke-width', 2)
                .attr('transform', `translate(${chartMargin.left},${chartMargin.top})`)
                .attr('d', speedLine)
            chart
                .append('g')
                .attr('transform', `translate(${width - chartMargin.left}, ${chartMargin.top})`)
                .call(axisRight(speedScale).ticks(height / 30))
        }
    })

    createEffect(() => {
        const trackActive = $trackActive()
        if (!trackActive) return
        const tp = $trackpointActive()
        const chart = select(chartSvg)
        const width = chartSvg.clientWidth
        const height = chartSvg.clientHeight
        let gActive: Selection<any, any, any, any> = chart.selectChild('.active')
        gActive.remove()
        if (tp === undefined) {
            return
        }
        gActive = chart.append('g').attr('class', 'active')

        const x =
            chartMargin.left +
            (trackActive.filtered.indexOf(tp) / trackActive.filtered.length) *
                (width - chartMargin.left - chartMargin.right)
        gActive
            .append('line')
            .attr('x1', x)
            .attr('x2', x)
            .attr('y1', 0)
            .attr('y2', height)
            .attr('stroke', '#222222')
            .attr('stroke-width', 2)

        if (!map.getLayer('active')) {
            map.addLayer({
                id: 'active',
                type: 'circle',
                source: {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: []
                    }
                },
                paint: {
                    'circle-radius': 6,
                    'circle-color': pathColors[Math.floor(hash(trackActive.name) % pathColors.length)]
                }
            })
        }
        ;(map.getSource(map.getLayer('active')!.source)! as GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: tp.position
                    },
                    properties: {}
                }
            ]
        })
    })

    const formatDuration = (secondsTotal: number) => {
        let total = secondsTotal
        const hours = Math.floor(total / 3600)
        total -= 3600 * hours
        const minutes = Math.floor(total / 60)
        total -= 60 * minutes
        return [hours > 0 ? `${hours}h` : undefined, `${minutes}m`].filter(s => !!s).join('')
    }

    const trackpointCompactPreview = (tp: Trackpoint, track: Track) => {
        const timestamp = tp.timestamp ? format(tp.timestamp, 'HH:mm:ss') : ''
        const duration = tp.timestamp
            ? formatDuration(differenceInSeconds(tp.timestamp, track.filtered[0].timestamp!)).padStart(5)
            : ''
        const elevation = tp.position.length > 2 ? `${tp.position[2].toFixed()}m`.padStart(4) : ''
        const speed = tp.speed ? `${tp.speed.toFixed()}kph`.padStart(5) : ''
        return [timestamp, duration, elevation, speed].filter(s => s !== '').join(' ')
    }

    const averageSpeed = (track: Track) => {
        const moving = track.filtered
            .filter(tp => tp.speed !== undefined && tp.speed > movingSpeedThreshold)
            .map(tp => tp.speed!)
        return moving.reduce((a, b) => a + b, 0) / moving.length
    }

    return (
        <>
            <div id="map" />
            <div id="overlay">
                <table class="tracks">
                    <tbody>
                        <For each={$tracks()}>
                            {track => (
                                <tr
                                    onClick={() => setTrackActive($trackActive() === track ? undefined : track)}
                                    classList={{ active: track.timestamp === $trackActive()?.timestamp }}
                                >
                                    <td>{format(track.timestamp, 'yyyy-MM-dd HH:mm')}</td>
                                    <td class="number">{track.distance.toFixed()}m</td>
                                    <td class="number">{track.duration ? formatDuration(track.duration) : 'N/A'}</td>
                                    <td class="number">
                                        {track.duration ? `${averageSpeed(track).toFixed(1)}kph` : 'N/A'}
                                    </td>
                                    <td class="number">{`${track.elevation.asc.toFixed()}up`}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
                <Show when={$trackActive()}>
                    <div class="track-active">
                        <span>
                            {$trackpointActive()
                                ? trackpointCompactPreview($trackpointActive()!, $trackActive()!)
                                : '\u00a0'}
                        </span>
                        <svg ref={chartSvg} />
                    </div>
                </Show>
            </div>
        </>
    )
}

render(() => <Main />, document.getElementById('root')!)
