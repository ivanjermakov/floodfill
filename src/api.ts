import { Position } from "geojson"

export type Track = {
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

export type Trackpoint = {
    position: Position
    distance: number
    timestamp?: string
    /**
     * kph
     */
    speed?: number
}

