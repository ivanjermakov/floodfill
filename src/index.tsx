/* @refresh reload */

import distance from '@turf/distance'
import { Selection, axisBottom, axisLeft, axisRight, extent, line, max, min, scaleLinear, scaleTime, select } from 'd3'
import { differenceInSeconds } from 'date-fns/differenceInSeconds'
import { format } from 'date-fns/format'
import { FeatureCollection, LineString, Position } from 'geojson'
import { AddLayerObject, GeoJSONSource, Map } from 'maplibre-gl'
import { CgShapeCircle } from 'solid-icons/cg'
import { Component, For, Match, Show, Switch, createEffect, createSignal, onMount, untrack } from 'solid-js'
import { render } from 'solid-js/web'
import { Grid } from './Grid'
import { Track, Trackpoint } from './api'
import { averageSpeedWindowSeconds } from './gpx'
import './index.css'

const style = {
    stadia: {
        id: 'stadia',
        type: 'raster',
        source: {
            type: 'raster',
            tiles: ['https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 20
        },
        layout: {
            visibility: 'none'
        }
    } as AddLayerObject,
    cyclosm: {
        id: 'cyclosm',
        type: 'raster',
        source: {
            type: 'raster',
            tiles: ['https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 20
        },
        layout: {
            visibility: 'none'
        }
    } as AddLayerObject
}

const pathColors = [
    '#eff1f3',
    '#fef766',
    '#f0b808',
    '#e3170a',
    '#fd3e81',
    '#ffa3af',
    '#ff66d8',
    '#cb48b7',
    '#b071c1',
    '#dab6fc',
    '#7d83ff',
    '#5aa9e6',
    '#00a1e4',
    '#007cbe',
    '#7fb069',
    '#00af54',
    '#7cfef0',
    '#85ff9e',
    '#5dfdcb',
    '#009fb7'
]

type RouteSegment = {
    from: Position
    to: Position
    geojson: FeatureCollection
}

const hash = (str: string) => {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) + hash + str.charCodeAt(i)
    }
    return hash >>> 0
}

const movingSpeedThreshold = 4

let map!: Map

const [$mapLoaded, setMapLoaded] = createSignal(false)
const [$windowSize, setWindowSize] = createSignal<{ width: number; height: number }>()
const [$tracks, setTracks] = createSignal<Track[]>([])
const [$trackHovered, setTrackHovered] = createSignal<Track | undefined>()
const [$trackActive, setTrackActive] = createSignal<Track | undefined>()

let trackActiveSvg!: SVGSVGElement
const trackActiveMargin = { top: 10, right: 30, bottom: 20, left: 30 }
const [$trackpointActive, setTrackpointActive] = createSignal<Trackpoint | undefined>()
let dataSvg!: SVGSVGElement
const dataMargin = { top: 10, right: 20, bottom: 20, left: 40 }

type Mode = 'track' | 'data' | 'plan'
const [$mode, setMode] = createSignal<Mode>('track')
const [$routeWaypoints, setRouteWaypoints] = createSignal<Position[]>([])
const [$routeDirty, setRouteDirty] = createSignal<void>(undefined, { equals: false })
const [$route, setRoute] = createSignal<RouteSegment[]>([])
let heldWaypointIndex: number | undefined = undefined

let importInput!: HTMLInputElement

const Main: Component = () => {
    const mount = async () => {
        const $nodes: Promise<[string, string][][]> = fetch('/nodes.json').then(r => r.json())
        const $tracks = loadTracks()

        window.addEventListener('resize', () => setWindowSize({ width: window.innerWidth, height: window.innerHeight }))
        map = new Map({
            container: 'map',
            style: { version: 8, sources: {}, layers: [] },
            attributionControl: false,
            center: [21, 52.23],
            zoom: 11,
            pixelRatio: 1,
            canvasContextAttributes: { preserveDrawingBuffer: true }
        })
        // map.dragRotate.disable()
        // map.keyboard.disable()
        // map.touchZoomRotate.disableRotation()
        // map.on('move', () => console.debug(map.getCenter(), map.getZoom()))
        map.scrollZoom.enable()
        map.addControl(
            new Grid({
                width: 5e3,
                height: 5e3,
                minZoom: 9,
                origin: map.getCenter().toArray(),
                paint: {
                    'line-color': '#555555',
                    'line-width': 1
                }
            })
        )

        await new Promise(done => map.on('load', done))

        map.addLayer(style.stadia)
        map.addLayer(style.cyclosm)

        setMapLoaded(true)

        const nodes = await $nodes
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
                'line-color': '#aa5555',
                'line-width': 1
            }
        })

        const tracks = await $tracks
        setTracks(tracks)

        map.addLayer({
            id: 'route-waypoints',
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
                'circle-color': pathColors[6]
            }
        })
        map.on('click', 'route-waypoints', e => {
            if (e.defaultPrevented) return
            e.preventDefault()
            const routeWaypoints = $routeWaypoints()

            const distances = routeWaypoints.map(wp => distance(wp, e.lngLat.toArray()))
            const idx = distances.indexOf(Math.min(...distances))
            setRouteWaypoints($routeWaypoints().filter((_, i) => i !== idx))
            setRouteDirty()
        })
        map.on('mousedown', 'route-waypoints', e => {
            e.preventDefault()
            const routeWaypoints = $routeWaypoints()

            const distances = routeWaypoints.map(wp => distance(wp, e.lngLat.toArray()))
            const idx = distances.indexOf(Math.min(...distances))
            heldWaypointIndex = idx
            map.setLayoutProperty('route-lines-hover', 'visibility', 'none')
        })
        map.on('mouseenter', 'route-waypoints', () => (map.getCanvas().style.cursor = 'crosshair'))
        map.on('mouseleave', 'route-waypoints', () => (map.getCanvas().style.cursor = 'auto'))

        const routeLinesIds = ['route-lines', 'route-lines-hover']
        routeLinesIds.forEach(id =>
            map.addLayer({
                id,
                type: 'line',
                source: {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: []
                    }
                },
                paint: {
                    'line-width': 5,
                    'line-dasharray': [4, 2],
                    'line-color': pathColors[6],
                    'line-opacity': 0.5
                }
            })
        )
        map.on('click', 'route-lines', e => {
            if (e.defaultPrevented) return

            if (e.features?.length === 0) return
            const pos = e.lngLat.toArray()
            e.preventDefault()

            const feature = e.features![0]
            const insertIndex: number = feature.properties.index + 1
            const routeWaypoints = [...$routeWaypoints()]
            routeWaypoints.splice(insertIndex, 0, pos)
            setRouteWaypoints(routeWaypoints)
            setRouteDirty()
        })
        map.on('mouseenter', 'route-lines', () => (map.getCanvas().style.cursor = 'crosshair'))
        map.on('mouseleave', 'route-lines', () => (map.getCanvas().style.cursor = 'auto'))

        map.addLayer({
            id: 'route',
            type: 'line',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            },
            paint: {
                'line-width': 5,
                'line-color': pathColors[4]
            }
        })

        map.on('click', e => {
            if (e.defaultPrevented) return
            setRouteWaypoints([...$routeWaypoints(), e.lngLat.toArray()])
            setRouteDirty()
        })
        map.on('mousemove', e => {
            const pos = e.lngLat.toArray()
            updateHoverRouteLines(pos)

            if (heldWaypointIndex !== undefined) {
                const routeWaypoints = [...$routeWaypoints()]
                routeWaypoints[heldWaypointIndex] = pos
                setRouteWaypoints(routeWaypoints)
            }
        })
        map.on('mouseup', () => {
            if (heldWaypointIndex === undefined) return
            heldWaypointIndex = undefined
            map.setLayoutProperty('route-lines-hover', 'visibility', 'visible')
            setRouteDirty()
        })
    }

    const loadTracks = async () => {
        const trackTimestamps: string[] = await (await fetch('/tracks')).json()
        return await Promise.all(
            trackTimestamps.map(async timestamp => {
                const track: Track = await (await fetch(`/track?timestamp=${encodeURIComponent(timestamp)}`)).json()
                return track
            })
        )
    }

    const updateTracks = async () => {
        const tracks = $tracks()
        tracks.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        await Promise.all(
            tracks.toReversed().map(async track => {
                if (map.getLayer(track.timestamp)) return
                map.addLayer({
                    id: track.timestamp,
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
                        'line-color': pathColors[Math.floor(hash(track.timestamp) % pathColors.length)],
                        'line-opacity-transition': { duration: 0 },
                        'line-width': 2
                    }
                })
            })
        )

        setTracks(tracks)
        console.debug(tracks)
    }

    const updateD3 = () => {
        $windowSize()
        const mode = $mode()
        const tracks = $tracks()
        const trackActive = $trackActive()
        updateTrackActiveSvg(mode, tracks, trackActive)
        updateDataSvg(mode, tracks)
    }

    const updateTrackActiveSvg = (mode: string, tracks: Track[], trackActive: Track | undefined) => {
        if (mode !== 'track') return

        tracks
            .filter(track => map.getLayer(track.timestamp))
            .forEach(track =>
                map.setLayoutProperty(
                    track.timestamp,
                    'visibility',
                    trackActive === undefined || track.timestamp === trackActive.timestamp ? 'visible' : 'none'
                )
            )

        if (!trackActive) return

        const width = trackActiveSvg.clientWidth
        const height = trackActiveSvg.clientHeight

        trackActiveSvg.addEventListener('mousemove', e => {
            if (e.offsetX < trackActiveMargin.left || e.offsetX > width - trackActiveMargin.right) {
                setTrackpointActive(undefined)
                return
            }
            const idx = Math.floor(
                ((e.offsetX - trackActiveMargin.left) / (width - trackActiveMargin.left - trackActiveMargin.right)) *
                    trackActive.filtered.length
            )
            if (idx < 0 || idx >= trackActive.filtered.length) {
                setTrackpointActive(undefined)
                return
            }
            setTrackpointActive(trackActive.filtered[idx])
        })
        trackActiveSvg.addEventListener('mouseleave', () => setTrackpointActive(undefined))

        const elevationData = trackActive.filtered.map(p => ({ date: new Date(p.timestamp), value: p.position[2] }))
        const xScale = scaleTime()
            .domain(extent(elevationData, d => d.date) as [Date, Date])
            .range([trackActiveMargin.left, width - trackActiveMargin.right])

        const elevationScale = scaleLinear()
            .domain([min(elevationData, d => d.value)!, max(elevationData, d => d.value)!])
            .range([height - trackActiveMargin.top - trackActiveMargin.bottom, 0])
        const elevationLine = line<{ date: Date; value: number }>()
            .x(d => xScale(d.date))
            .y(d => elevationScale(d.value))

        select(trackActiveSvg).selectChildren().remove()
        select(trackActiveSvg)
            .append('g')
            .attr('transform', `translate(0, ${height - trackActiveMargin.bottom})`)
            .call(
                axisBottom(xScale)
                    .tickFormat(d => format(d as Date, 'HH:mm'))
                    .ticks(20)
            )

        select(trackActiveSvg)
            .append('path')
            .datum(elevationData)
            .attr('fill', 'none')
            .attr('stroke', pathColors[0])
            .attr('stroke-width', 1)
            .attr('transform', `translate(0, ${trackActiveMargin.top})`)
            .attr('d', elevationLine)
        select(trackActiveSvg)
            .append('g')
            .attr('transform', `translate(${trackActiveMargin.left}, ${trackActiveMargin.top})`)
            .call(axisLeft(elevationScale).ticks(height / 30))

        if (trackActive.filtered[0].speed !== undefined) {
            const speedData = trackActive.filtered.map(p => ({
                date: new Date(p.timestamp),
                value: p.speed!
            }))
            const speedScale = scaleLinear()
                .domain([0, Math.min(50, max(speedData, d => d.value)!)])
                .range([height - trackActiveMargin.top - trackActiveMargin.bottom, 0])
            const speedLine = line<{ date: Date; value: number }>()
                .x(d => xScale(d.date))
                .y(d => speedScale(d.value))
            select(trackActiveSvg)
                .append('path')
                .datum(speedData)
                .attr('fill', 'none')
                .attr('stroke', pathColors[1])
                .attr('opacity', 0.3)
                .attr('stroke-width', 1)
                .attr('transform', `translate(0, ${trackActiveMargin.top})`)
                .attr('d', speedLine)

            const avgSpeedData = []
            for (let i = 0; i < speedData.length; i++) {
                const slice = speedData.slice(Math.max(0, i - averageSpeedWindowSeconds), i).map(d => d.value)
                let avg = slice.reduce((a, b) => a + b, 0) / slice.length
                if (Number.isNaN(avg)) avg = 0
                avgSpeedData.push({ date: speedData[i].date, value: avg })
            }
            select(trackActiveSvg)
                .append('path')
                .datum(avgSpeedData)
                .attr('fill', 'none')
                .attr('stroke', pathColors[1])
                .attr('stroke-width', 1)
                .attr('transform', `translate(0, ${trackActiveMargin.top})`)
                .attr('d', speedLine)

            select(trackActiveSvg)
                .append('g')
                .attr('transform', `translate(${width - trackActiveMargin.right}, ${trackActiveMargin.top})`)
                .call(axisRight(speedScale).ticks(height / 30))
        }
    }

    const updateDataSvg = (mode: string, tracks: Track[]) => {
        if (mode !== 'data') return

        const width = dataSvg.clientWidth
        const height = dataSvg.clientHeight

        const speedData = tracks.map(t => ({ date: new Date(t.timestamp), value: averageSpeed(t) }))
        const xScale = scaleTime()
            .domain(extent(speedData, d => d.date) as [Date, Date])
            .range([dataMargin.left, width - dataMargin.right])
            .nice()

        const speedScale = scaleLinear<number>()
            .domain([min(speedData, d => d.value)! - 2, max(speedData, d => d.value)! + 2])
            .range([height - dataMargin.top - dataMargin.bottom, 0])

        const distanceData = tracks.map(t => t.distance)
        const distanceScale = scaleLinear<number>()
            .domain([0, max(distanceData, d => d)!])
            .range([2, 60])

        select(dataSvg).selectChildren().remove()
        select(dataSvg)
            .append('g')
            .attr('transform', `translate(0, ${height - dataMargin.bottom})`)
            .call(
                axisBottom(xScale)
                    .tickFormat(d => format(d as Date, 'MM-dd'))
                    .ticks(50)
            )
        select(dataSvg)
            .append('g')
            .attr('transform', `translate(${dataMargin.left}, ${dataMargin.top})`)
            .call(axisLeft(speedScale).ticks(height / 30))

        const [minSpeed, maxSpeed] = speedScale.domain()
        const ticks = Array.from(
            { length: Math.ceil((maxSpeed - minSpeed) / 5) + 1 },
            (_, i) => Math.floor(minSpeed / 5) * 5 + i * 5
        )

        select(dataSvg)
            .append('g')
            .attr('class', 'grid-lines')
            .selectAll('line')
            .data(ticks)
            .join('line')
            .attr('x1', dataMargin.left)
            .attr('x2', width - dataMargin.right)
            .attr('y1', d => speedScale(d) + dataMargin.top)
            .attr('y2', d => speedScale(d) + dataMargin.top)
            .attr('stroke', '#ccc')
            .attr('stroke-dasharray', '1,10')

        select(dataSvg)
            .selectAll('circle')
            .data(speedData)
            .join('circle')
            .attr('cx', d => xScale(d.date))
            .attr('cy', d => speedScale(d.value) + dataMargin.top)
            .attr('r', (_, i) => distanceScale(distanceData[i]))
            .attr('fill', (_, i) => pathColors[Math.floor(hash(tracks[i].timestamp) % pathColors.length)])
    }

    const updateActive = () => {
        const cleanup = () => {
            if (map.getLayer('active')) {
                map.removeLayer('active')
                map.removeSource('active')
            }
        }
        const trackActive = $trackActive()
        if (!trackActive) {
            cleanup()
            return
        }
        const tp = $trackpointActive()
        const chart = select(trackActiveSvg)
        const width = trackActiveSvg.clientWidth
        const height = trackActiveSvg.clientHeight

        let gActive: Selection<any, any, any, any> = chart.selectChild('.active')
        gActive.remove()
        if (tp === undefined) {
            cleanup()
            return
        }
        gActive = chart.append('g').attr('class', 'active')

        const x =
            trackActiveMargin.left +
            (trackActive.filtered.indexOf(tp) / trackActive.filtered.length) *
                (width - trackActiveMargin.left - trackActiveMargin.right)
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
                    'circle-color': pathColors[Math.floor(hash(trackActive.timestamp) % pathColors.length)]
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
    }

    const updateHovered = () => {
        const tracks = $tracks()
        const trackHovered = $trackHovered()
        const trackActive = $trackActive()

        tracks
            .filter(track => map.getLayer(track.timestamp))
            .forEach(track =>
                map.setPaintProperty(
                    track.timestamp,
                    'line-opacity',
                    trackActive || trackHovered === undefined || track.timestamp === trackHovered.timestamp ? 1 : 0.3
                )
            )
    }

    const updateMode = () => {
        const mapLoaded = $mapLoaded()
        const mode = $mode()
        const tracks = $tracks()

        if (!mapLoaded) return
        const baseIds = ['stadia', 'cyclosm']

        baseIds.forEach(id => {
            map.setLayoutProperty(id, 'visibility', 'none')
        })

        switch (mode) {
            case 'track':
                map.setLayoutProperty('stadia', 'visibility', 'visible')
                break
            case 'plan':
                map.setLayoutProperty('cyclosm', 'visibility', 'visible')
                break
        }

        setTrackActive(undefined)
        ;['nodes', ...tracks.map(t => t.timestamp)]
            .filter(id => map.getLayer(id))
            .forEach(layer => map.setLayoutProperty(layer, 'visibility', mode === 'track' ? 'visible' : 'none'))
    }

    const readFile = async (file: File, encoding: string = 'utf-8'): Promise<string> => {
        const reader = new FileReader()
        return new Promise<string>(resolve => {
            reader.onloadend = () => {
                resolve(reader.result!.toString())
            }
            reader.readAsText(file, encoding)
        })
    }

    const uploadGpx = async (e: InputEvent) => {
        for (const file of (e.target as HTMLInputElement).files!) {
            const data = await readFile(file)
            const track = await (
                await fetch('/track', { method: 'POST', body: JSON.stringify({ name: file.name, data }) })
            ).json()
            const tracks = [...$tracks(), track]
            tracks.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
            setTracks(tracks)
        }
    }

    const formatDuration = (secondsTotal: number) => {
        let total = secondsTotal
        const hours = Math.floor(total / 3600)
        total -= 3600 * hours
        const minutes = Math.floor(total / 60)
        total -= 60 * minutes
        return [hours > 0 ? `${hours}h` : undefined, `${minutes}m`].filter(s => !!s).join('')
    }

    const trackpointCompactPreview = (tp: Trackpoint, track: Track) => {
        const index = track.filtered.indexOf(tp)
        const timestamp = format(tp.timestamp, 'HH:mm:ss')
        const duration = tp.timestamp
            ? formatDuration(differenceInSeconds(tp.timestamp, track.filtered[0].timestamp)).padStart(5)
            : ''
        const elevation = tp.position.length > 2 ? `${tp.position[2].toFixed()}m`.padStart(4) : ''

        let speed = ''
        if (tp.speed) {
            const slice = track.filtered
                .slice(Math.max(0, index - averageSpeedWindowSeconds), index)
                .map(d => d.speed ?? 0)
            let avg = slice.reduce((a, b) => a + b, 0) / slice.length
            if (Number.isNaN(avg)) avg = 0
            speed = `${avg.toFixed(1)}kph`.padStart(5)
        }

        return [timestamp, `${(tp.distance / 1000).toFixed(1)}km`, duration, elevation, speed]
            .filter(s => s !== '')
            .join(' ')
    }

    const averageSpeed = (track: Track) => {
        const moving = track.filtered
            .filter(tp => tp.speed !== undefined && tp.speed > movingSpeedThreshold)
            .map(tp => tp.speed!)
        return moving.reduce((a, b) => a + b, 0) / moving.length
    }

    const shareTrack = async (track: Track) => {
        const mapCanvas = document.getElementsByClassName('maplibregl-canvas')[0] as HTMLCanvasElement

        const canvas = new OffscreenCanvas(mapCanvas.height, mapCanvas.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(
            mapCanvas,
            (mapCanvas.width - mapCanvas.height) / 2,
            0,
            mapCanvas.height,
            mapCanvas.height,
            0,
            0,
            canvas.width,
            canvas.height
        )

        ctx.textAlign = 'center'
        ctx.fillStyle = 'white'

        let fontSize = 86
        const lineHeight = 1.5
        ctx.font = `${fontSize}px Space Mono`
        let height = canvas.height / 2 - fontSize
        ctx.fillText(`${(track.distance / 1000).toFixed(1)} km`, canvas.width / 2, height)
        height += lineHeight * fontSize

        fontSize = 48
        ctx.font = `${fontSize}px Space Mono`
        ctx.fillText(format(track.timestamp, 'MMMM do yyyy, HH:mm'), canvas.width / 2, height)
        height += lineHeight * fontSize

        if (track.duration) {
            ctx.font = `${fontSize}px Space Mono`
            ctx.fillText(
                `${formatDuration(track.duration)} at avg ${averageSpeed(track).toFixed(1)}kph`,
                canvas.width / 2,
                height
            )
            height += lineHeight * fontSize
        }

        const blob = await canvas.convertToBlob({ type: 'image/png' })
        downloadFile(blob, `track_result_${track.timestamp}.png`)
    }

    const downloadFile = (blob: Blob, name: string) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        URL.revokeObjectURL(a.href)
    }

    const updateRouteWaypoints = async () => {
        const routeWaypoints = $routeWaypoints()

        const routeWaypointsData = map.getSource('route-waypoints') as GeoJSONSource
        const routeLinesData = map.getSource('route-lines') as GeoJSONSource

        if (!routeWaypointsData) return

        routeWaypointsData.setData({
            type: 'FeatureCollection',
            features: routeWaypoints.map((wp, i) => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: wp
                },
                properties: {
                    index: i
                }
            }))
        })

        routeLinesData.setData({
            type: 'FeatureCollection',
            features: routeWaypoints.slice(0, -1).map((_, i) => ({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [routeWaypoints[i], routeWaypoints[i + 1]]
                },
                properties: {
                    index: i
                }
            }))
        })
    }

    const recalculateRoute = async () => {
        $routeDirty()
        const route = [...untrack($route)]
        const routeWaypoints = untrack($routeWaypoints)

        const newRoute: RouteSegment[] = []
        for (let i = 0; i < routeWaypoints.length - 1; i++) {
            const from = routeWaypoints[i]
            const to = routeWaypoints[i + 1]
            const cache = route.find(segment => segment.from === from && segment.to === to)
            if (cache) {
                newRoute.push(cache)
            } else {
                const url = `https://brouter.de/brouter?lonlats=${from[0]},${from[1]}|${to[0]},${to[1]}&profile=trekking&alternativeidx=0&format=geojson`
                const geojson = (await (await fetch(url)).json()) as FeatureCollection
                console.debug('route segment', geojson)
                newRoute.push({
                    from,
                    to,
                    geojson
                })
            }
        }
        setRoute(newRoute)
    }

    const updateHoverRouteLines = (pos: Position) => {
        const routeWaypoints = $routeWaypoints()

        if (routeWaypoints.length < 1) return

        const routeLinesHoveredData = map.getSource('route-lines-hover') as GeoJSONSource
        if (!routeLinesHoveredData) return

        routeLinesHoveredData.setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [routeWaypoints.at(-1)!, pos]
                    },
                    properties: {}
                }
            ]
        })
    }

    const updateRoute = () => {
        const route = $route()

        const routeData = map.getSource('route') as GeoJSONSource

        if (!routeData) return

        routeData.setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {
                        type: 'MultiLineString',
                        coordinates: route.map(
                            segment => (segment.geojson.features[0].geometry as LineString).coordinates
                        )
                    },
                    properties: {}
                }
            ]
        })

        console.log(
            route.map(wp => {
                const props = wp.geojson.features[0].properties!
                return [props['total-time'], props['track-length'], props['plain-ascend']]
            })
        )
    }

    const exportRoute = () => {
        const name = 'route.gpx'
        const route = $route()
        const waypoints = [...route.map(wp => wp.from), route.at(-1)!.to].map(
            (wp, i) => `    <wpt lon="${wp[0]}" lat="${wp[1]}"><name>${i + 1}</name></wpt>`
        )
        const trackpoints = route
            .flatMap(route => (route.geojson.features[0].geometry as LineString).coordinates)
            .map(tp => `            <trkpt lon="${tp[0]}" lat="${tp[1]}"><ele>${tp[2]}</ele></trkpt>`)
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd" version="1.1" creator="Flood Fill">
${waypoints.join('\n')}
    <trk>
    <name>${name}</name>
        <trkseg>
${trackpoints.join('\n')}
        </trkseg>
    </trk>
</gpx>`
        console.debug('xml', xml)
        const blob = new Blob([xml])
        downloadFile(blob, name)
    }

    onMount(mount)
    createEffect(updateTracks)
    createEffect(updateD3)
    createEffect(updateActive)
    createEffect(updateHovered)
    createEffect(updateMode)
    createEffect(updateRouteWaypoints)
    createEffect(recalculateRoute)
    createEffect(updateRoute)

    return (
        <>
            <div id="map" hidden={$mode() === 'data'} />
            <div id="overlay">
                <header>
                    <div class="group">
                        <button
                            type="button"
                            classList={{ active: $mode() === 'track' }}
                            onClick={() => setMode('track')}
                        >
                            Track
                        </button>
                        <button
                            type="button"
                            classList={{ active: $mode() === 'data' }}
                            onClick={() => setMode('data')}
                        >
                            Data
                        </button>
                        <button
                            type="button"
                            classList={{ active: $mode() === 'plan' }}
                            onClick={() => setMode('plan')}
                        >
                            Plan
                        </button>
                    </div>
                    <Switch>
                        <Match when={$mode() === 'track'}>
                            <div class="group">
                                <input
                                    type="file"
                                    ref={importInput}
                                    hidden={true}
                                    multiple={true}
                                    onInput={uploadGpx}
                                />
                                <button type="button" onClick={() => importInput.click()}>
                                    Import GPX
                                </button>
                            </div>
                        </Match>
                        <Match when={$mode() === 'plan'}>
                            <div class="group">
                                <button type="button" onClick={exportRoute}>
                                    Export GPX
                                </button>
                            </div>
                        </Match>
                    </Switch>
                </header>
                <Show when={$mode() === 'track'}>
                    <div class="tracks">
                        <table>
                            <tbody>
                                <For each={$tracks()}>
                                    {track => (
                                        <tr
                                            onClick={() => {
                                                const active = $trackActive() === track
                                                setTrackActive(undefined)
                                                setTrackActive(active ? undefined : track)
                                            }}
                                            onMouseEnter={() => setTrackHovered(track)}
                                            onMouseLeave={() => setTrackHovered(undefined)}
                                            classList={{ active: track.timestamp === $trackActive()?.timestamp }}
                                        >
                                            <td class="icon">
                                                <CgShapeCircle
                                                    style={{
                                                        color: pathColors[
                                                            Math.floor(hash(track.timestamp) % pathColors.length)
                                                        ]
                                                    }}
                                                />
                                            </td>
                                            <td>{track.name}</td>
                                            <td>{format(track.timestamp, 'yyyy-MM-dd HH:mm')}</td>
                                            <td class="number">{(track.distance / 1000).toFixed(1)}km</td>
                                            <td class="number">
                                                {track.duration ? formatDuration(track.duration) : 'N/A'}
                                            </td>
                                            <td class="number">
                                                {track.duration ? `${averageSpeed(track).toFixed(1)}kph` : 'N/A'}
                                            </td>
                                            <td class="number">{`${track.elevation.asc.toFixed()}up`}</td>
                                        </tr>
                                    )}
                                </For>
                                <tr>
                                    <td />
                                    <td>Total</td>
                                    <td class="number">
                                        {(
                                            $tracks()
                                                .map(t => t.distance)
                                                .reduce((a, b) => a + b, 0) / 1000
                                        ).toFixed()}
                                        km
                                    </td>
                                    <td class="number">
                                        {`${(
                                            $tracks()
                                                .map(t => t.duration ?? 0)
                                                .reduce((a, b) => a + b, 0) / 3600
                                        ).toFixed()}h`}
                                    </td>
                                    <td />
                                    <td />
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <Show when={$trackActive()}>
                        <div class="track-active">
                            <header>
                                <button type="button" onClick={() => shareTrack($trackActive()!)}>
                                    Share
                                </button>
                                <span>
                                    {$trackpointActive()
                                        ? trackpointCompactPreview($trackpointActive()!, $trackActive()!)
                                        : '\u00a0'}
                                </span>
                            </header>
                            <svg ref={trackActiveSvg} />
                        </div>
                    </Show>
                </Show>
                <Show when={$mode() === 'data'}>
                    <div class="data">
                        <svg ref={dataSvg} />
                    </div>
                </Show>
            </div>
        </>
    )
}

render(() => <Main />, document.getElementById('root')!)
