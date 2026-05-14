import destination from '@turf/destination'
import { Position } from 'geojson'
import { IControl, Map } from 'maplibre-gl'

export type GridConfig = {
    width: number
    height: number
    origin: Position
    paint: Record<string, any>
    minZoom?: number
    maxZoom?: number
    limit?: number
}

const gridId = 'grid'

export class Grid implements IControl {
    config: GridConfig
    map!: Map
    loadFn = () => this.load()
    updateFn = () => this.update()

    constructor(config: GridConfig) {
        this.config = config
    }

    onAdd(map: Map) {
        this.map = map

        this.map.on('load', this.loadFn)
        this.map.on('move', this.updateFn)
        if (this.map.loaded()) this.update()

        return document.createElement('div')
    }

    onRemove() {
        const source = this.map.getSource(gridId)
        if (source) {
            this.map.removeLayer(gridId)
            this.map.removeSource(gridId)
        }

        this.map.off('load', this.loadFn)
        this.map.off('move', this.updateFn)
    }

    load() {
        const limit = this.config.limit ?? 64
        const lats: number[] = []
        const longs: number[] = []

        let pos = this.config.origin
        longs.push(pos[0])
        for (let count = 0; count < limit / 2; count++) {
            pos = destination(pos, this.config.height, 90, { units: 'meters' }).geometry.coordinates
            longs.push(pos[0])
        }
        pos = this.config.origin
        for (let count = 0; count < limit / 2; count++) {
            pos = destination(pos, this.config.height, -90, { units: 'meters' }).geometry.coordinates
            longs.push(pos[0])
        }
        longs.sort()

        pos = this.config.origin
        lats.push(pos[1])
        for (let count = 0; count < limit / 2; count++) {
            pos = destination(pos, this.config.height, 0, { units: 'meters' }).geometry.coordinates
            lats.push(pos[1])
        }
        pos = this.config.origin
        for (let count = 0; count < limit / 2; count++) {
            pos = destination(pos, this.config.height, 180, { units: 'meters' }).geometry.coordinates
            lats.push(pos[1])
        }
        lats.sort()

        this.map.addLayer({
            id: gridId,
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
                                coordinates: [
                                    ...longs.map(l => [
                                        [l, lats[0]],
                                        [l, lats.at(-1)!]
                                    ]),
                                    ...lats.map(l => [
                                        [longs[0], l],
                                        [longs.at(-1)!, l]
                                    ])
                                ]
                            },
                            properties: {}
                        }
                    ]
                }
            },
            paint: this.config.paint
        })
    }

    update() {
        if (!this.map || this.map.loaded()) return
        const active = this.active()
        this.map.setLayoutProperty(gridId, 'visibility', active ? 'visible' : 'none')
    }

    active() {
        const minZoom = this.config.minZoom ?? 0
        const maxZoom = this.config.maxZoom ?? 22
        const zoom = this.map.getZoom()
        return minZoom <= zoom && zoom < maxZoom
    }
}
