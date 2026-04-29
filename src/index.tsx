/* @refresh reload */
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

const Main: Component = () => {
    onMount(async () => {
        const map = new Map({
            container: 'map',
            style: 'map/ofm-dark.json',
            attributionControl: false,
            center: [21, 52.23],
            zoom: 11
        })
        // map.dragRotate.disable()
        // map.keyboard.disable()
        // map.touchZoomRotate.disableRotation()
        map.scrollZoom.enable()
        await new Promise(done => map.on('load', done))

        map.on('move', () => {
            console.debug(map.getCenter(), map.getZoom())
        })
        await Promise.all(
            [
                'onthegomap-21.6-km-route.gpx',
                'onthegomap-18.5-km-route.gpx',
                'onthegomap-25.6-km-route.gpx',
                'onthegomap-15.3-km-route.gpx'
            ].map(async routeFile => {
                const gpxRaw = await (await fetch(`gpx/${routeFile}`)).text()
                const parser = new DOMParser()
                const gpx = parser.parseFromString(gpxRaw, 'text/xml')
                // TODO: elevation and timestamp
                const readNumAttr = (e: Element, name: string) =>
                    Number.parseFloat(e.attributes.getNamedItem(name)!.value)
                const coordinates: Position[] = [...gpx.getElementsByTagName('trkpt')].map(point => [
                    readNumAttr(point, 'lon'),
                    readNumAttr(point, 'lat')
                ])
                console.debug(coordinates)
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
                                        coordinates
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
    })

    return (
        <>
            <div id="map" />
        </>
    )
}

render(() => <Main />, document.getElementById('root')!)
