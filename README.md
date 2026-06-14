# Flood Fill

Self-hosted cycling track manager and route planner with focus on visiting every cycle path in a city.

## Setup

### Cycleway nodes

1. Download .osm files of desired regions from [BBBike](https://extract.bbbike.org/)
2. Run `src/preprocess.ts`, it will populate SQLite `./database.db`

### Elevation data

1. Download .tif file of a desired region from [OpenTopography](https://portal.opentopography.org/raster?opentopoID=OTSRTM.082015.4326.1)
2. Place it under `./resource/srtm/output_hh.tif`

### Stadia tiles

Add your domain at [Stadia dashboard](https://docs.stadiamaps.com/authentication/), not required for `localhost` deployment.

## Workflow

1. Plan track with [BRouter](https://brouter.de/brouter-web) and export plan GPX
2. Import plan GPX into [Organic Maps](https://organicmaps.app) for navigation
3. Track actual GPX with [OutRun](https://outrun.tadris.de) or [Strava](https://www.strava.com)
4. Import actual GPX into Flood Fill

## Credit

- [Brouter](https://github.com/abrensch/brouter)
- [How I ran the length of every street in Pittsburgh: PAC TOM](https://www.youtube.com/watch?v=1c8i5SABqwU)
