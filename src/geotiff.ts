import { readFile } from 'fs/promises'
import GeoTIFF, { Dimensions, fromArrayBuffer, GeoTIFFImage, TypedArray } from 'geotiff'

const transform = (a: number, b: number, M: any[], roundToInt = false) => {
    const round = (v: number) => (roundToInt ? v | 0 : v)
    return [round(M[0] + M[1] * a + M[2] * b), round(M[3] + M[4] * a + M[5] * b)]
}

let buffer: Buffer<ArrayBuffer>
let tiff: GeoTIFF
let image: GeoTIFFImage
let rasters: TypedArray[] & Dimensions
let s: number[]
let t: number[]
let gpsToPixel: number[]

/**
 * @param path https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3
 */
export const initGeo = async (path: string) => {
    buffer = await readFile(path)
    tiff = await fromArrayBuffer(buffer.buffer)
    image = await tiff.getImage()
    rasters = await image.readRasters()
    s = image.fileDirectory.getValue('ModelPixelScale')!
    t = image.fileDirectory.getValue('ModelTiepoint')!
    const sx = s[0]
    const sy = -s[1]
    const gx = t[3]
    const gy = t[4]
    gpsToPixel = [-gx / sx, 1 / sx, 0, -gy / sy, 0, 1 / sy]
}

export const elevationAt = async (lon: number, lat: number): Promise<number | undefined> => {
    const [x, y] = transform(lon, lat, gpsToPixel, true)
    return rasters[0][x + y * rasters.width]
}
