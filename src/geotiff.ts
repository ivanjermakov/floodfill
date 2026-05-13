import { readFile } from 'fs/promises'
import GeoTIFF, { fromArrayBuffer, GeoTIFFImage } from 'geotiff'

let buffer: Buffer<ArrayBuffer>
let tiff: GeoTIFF
let image: GeoTIFFImage

/**
 * @param path https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3
 */
export const initGeo = async (path: string) => {
    buffer = await readFile(path)
    tiff = await fromArrayBuffer(buffer.buffer)
    image = await tiff.getImage()
}

export const elevationAt = async (lon: number, lat: number): Promise<number | undefined> => {
    const transform = (a: number, b: number, M: any[], roundToInt = false) => {
        const round = (v: number) => (roundToInt ? v | 0 : v)
        return [round(M[0] + M[1] * a + M[2] * b), round(M[3] + M[4] * a + M[5] * b)]
    }

    const s = image.fileDirectory.getValue('ModelPixelScale')!
    const t = image.fileDirectory.getValue('ModelTiepoint')!
    let [sx, sy, sz] = s
    const [px, py, k, gx, gy, gz] = t
    sy = -sy

    const gpsToPixel = [-gx / sx, 1 / sx, 0, -gy / sy, 0, 1 / sy]
    const [x, y] = transform(lon, lat, gpsToPixel, true)
    const rasters = await image.readRasters()
    const { width, [0]: raster } = rasters
    const elevation = raster[x + y * width]
    return elevation
}
