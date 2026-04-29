/* @refresh reload */
import { Map } from 'maplibre-gl'
import { Component, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import './index.css'

const Main: Component = () => {
    onMount(async () => {
        const map = new Map({
            container: 'map',
            style: 'https://tiles.openfreemap.org/styles/liberty',
            attributionControl: false,
            center: [21, 52.23],
            zoom: 11
        })
        await new Promise(done => map.on('load', done))
        map.on('move', () => {
            console.debug(map.getCenter(), map.getZoom())
        })
    })

    return (
        <>
            <div id="map" />
        </>
    )
}

render(() => <Main />, document.getElementById('root')!)
