import { readFile } from 'fs/promises'

function addQuotes(data: string) {
    const r = /(?<separator>[{,])(?<key>[a-zA-Z]+):/g
    return data.replace(r, '$<separator>"$<key>":')
}

// curl -X POST "https://mapa.um.warszawa.pl/mapviewer/foi?request=getfoi&version=1.0&bbox=0%3A1787369%3A9500502%3A9791137&width=760&height=1190&theme=dane_wawa.ROWERY_TRASY_TYP_8_18&dstsrid=2178&cachefoi=yes&tid=85_311281927602616807&aw=no" > resource/dane_wawa.ROWERY_TRASY_TYP_8_18.dat
const bikeLanesDat = (await readFile('resource/dane_wawa.ROWERY_TRASY_TOOLTIP.dat')).toString()
const bikeLanes = JSON.parse(addQuotes(bikeLanesDat)).foiarray
const dict: Record<string, number> = {}
for (const late of bikeLanes) {
    dict[late.id] ??= 0
    dict[late.id]++
}
// console.log(dict, Object.keys(dict).length)
console.log(bikeLanes)
