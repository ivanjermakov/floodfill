/* @refresh reload */

import { Selection, axisBottom, axisLeft, axisRight, extent, line, max, min, scaleLinear, scaleTime, select } from 'd3'
import { compareDesc, differenceInSeconds, format } from 'date-fns'
import { GeoJSONSource, Map } from 'maplibre-gl'
import { Component, For, Show, createEffect, createSignal, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import { Grid } from './Grid'
import { Track, Trackpoint } from './api'
import './index.css'

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

const hash = (str: string) => {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) + hash + str.charCodeAt(i)
    }
    return hash >>> 0
}

// TODO: server
const gpxs = [
    '20260430-181917.gpx',
    '20260507-185410.gpx',
    '20260510-160805.gpx',
    '20260511-184017.gpx',
    '20260512-181352.gpx',
    '20260513-170937.gpx',
    '20260514-115529.gpx',
    '20260515-192042.gpx',
    '20260517-110028.gpx',
    '20260518-150758.gpx',
    '20260519-180403.gpx',
    '20260520-174005.gpx',
    '20260521-182806.gpx',
    '20260524-192645.gpx'
]

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
            zoom: 11,
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
                'line-color': '#aa5555',
                'line-width': 1
            }
        })

        const tracks: Track[] = await (await fetch('/tracks')).json()
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
            .attr('stroke-width', 1)
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
                .attr('stroke-width', 1)
                .attr('transform', `translate(${chartMargin.left},${chartMargin.top})`)
                .attr('d', speedLine)
            chart
                .append('g')
                .attr('transform', `translate(${width - chartMargin.left}, ${chartMargin.top})`)
                .call(axisRight(speedScale).ticks(height / 30))
        }
    })

    createEffect(() => {
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
        const chart = select(chartSvg)
        const width = chartSvg.clientWidth
        const height = chartSvg.clientHeight

        let gActive: Selection<any, any, any, any> = chart.selectChild('.active')
        gActive.remove()
        if (tp === undefined) {
            cleanup()
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
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `track_result_${track.timestamp}.png`
        a.click()
        URL.revokeObjectURL(a.href)
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
                                    onClick={() => {
                                        const active = $trackActive() === track
                                        setTrackActive(undefined)
                                        setTrackActive(active ? undefined : track)
                                    }}
                                    classList={{ active: track.timestamp === $trackActive()?.timestamp }}
                                >
                                    <td>{format(track.timestamp, 'yyyy-MM-dd HH:mm')}</td>
                                    <td class="number">{(track.distance / 1000).toFixed(1)}km</td>
                                    <td class="number">{track.duration ? formatDuration(track.duration) : 'N/A'}</td>
                                    <td class="number">
                                        {track.duration ? `${averageSpeed(track).toFixed(1)}kph` : 'N/A'}
                                    </td>
                                    <td class="number">{`${track.elevation.asc.toFixed()}up`}</td>
                                </tr>
                            )}
                        </For>
                        <tr>
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
                        </tr>
                    </tbody>
                </table>
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
                        <svg ref={chartSvg} />
                    </div>
                </Show>
            </div>
        </>
    )
}

render(() => <Main />, document.getElementById('root')!)
