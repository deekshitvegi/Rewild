# Expedition texture attribution

- `terrain/grass.webp`, `granite.webp`, `ice.webp`, `mars.webp`, `regolith.webp`,
  `sand.webp`, `sandstone.webp`, `snow.webp`, `broadleaf.webp`, `pine.webp`,
  `snowpine.webp`: made for this project (Higgsfield generations, then made
  tileable / cut out).
- Rock and ground photographs from ambientCG (https://ambientcg.com), released
  under CC0 1.0 (public domain); colour map plus OpenGL normal map (`-n`),
  1024 x 1024, converted to WebP:
  - `terrain/rock-layered*.webp`: Rock022
  - `terrain/rock-red*.webp`: Rock061
  - `terrain/rock-dark*.webp`: Rock031
  - `terrain/rock-grey*.webp`: Rock050
  - `terrain/rock-ice*.webp`: Rock026
  - `terrain/basalt*.webp`: Rock033
  - `terrain/gravel*.webp`: Ground022
  - `terrain/dunes*.webp`: Ground097

## Earth

- `earth-blue-marble.jpg`: NASA Earth Observatory, Blue Marble: Next Generation,
  September 2004 (Reto Stöckli, NASA Earth Observatory), 5400 x 2700.
  https://visibleearth.nasa.gov/images/74142
- `earth-data.webp`: derived for the Expedition from
  - GEBCO 2008 topography and bathymetry as published by NASA Visible Earth
    (https://visibleearth.nasa.gov/images/73934 and
    https://visibleearth.nasa.gov/images/73963; GEBCO Compilation Group), and
  - the Blue Marble image above.

  4096 x 2048, equirectangular (row 0 at the north pole, column 0 at longitude
  -180). Red: signed distance to the coast in game metres, 128 + s / 4.6 (land
  positive). Green: the continent's height in game metres,
  4 + 26 log2(1 + e / 60) for land e metres high, or the sea's depth,
  2 + 30 log2(1 + d / 80) for water d metres deep. Blue: tree cover 0-255,
  from the Blue Marble's colour (dark, green land).

- `earth-clouds.webp`: Earth's cloud cover, from "Solarsystemscope texture 8k
  earth clouds.jpg" by Solar System Scope (https://www.solarsystemscope.com),
  made from NASA imagery, licensed CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/); taken from Wikimedia Commons
  as its 3840 x 1920 rendition and converted to WebP (grey, no other change).
  Same projection as the Blue Marble above.

## Mars

- `mars-mdim.webp`: the Mars Digital Image Model 2.1 (Viking orbiter mosaic),
  in the colour NASA Ames Research Center gave it, from the USGS Astrogeology
  Science Center's basemaps (MDIM21_AMES_recolor, same bucket as below).
  Public domain. Resampled to 4096 x 2048 equirectangular, centred on longitude
  0, east to the right.
- `mars-elevation.webp` and `mars-olympus.webp`: the elevation measured by the
  Mars Orbiter Laser Altimeter on NASA's Mars Global Surveyor (its gridded
  records at 128 and 64 pixels a degree, merged, as the USGS Astrogeology
  Science Center serves them: mola128_mola64_merge_90Nto90S_SimpleC_clon0,
  same bucket as below). Public domain. The whole planet averaged down to 2048 x 1024, and
  Olympus Mons (9 N to 29 N, 216 E to 236.5 E) at 64 pixels a degree; each
  pixel holds (metres above the datum + 8500) / 4 in 16 bits, red the high
  byte, green the low (lossless WebP).

## The Moon and Mercury

- `moons/moon.webp`: the LRO Wide Angle Camera global mosaic (NASA / GSFC /
  Arizona State University), and `mercury.webp`: the MESSENGER MDIS global
  basemap (NASA / Johns Hopkins APL / Carnegie Institution of Washington),
  both from the USGS Astrogeology Science Center's basemaps (same bucket as
  below). Public domain. Resampled to 4096 x 2048 equirectangular, centred on
  longitude 0, east to the right, greyscale coloured with a ramp from each
  world's real colour.

## Moons and Pluto (`moons/*.webp`)

Global maps from the USGS Astrogeology Science Center's planetary basemaps
(cloud-optimised GeoTIFFs at https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps3/),
built from NASA mission imagery: Viking (Phobos, Deimos), Galileo and Voyager
(Io, Ganymede, Callisto), Cassini (Mimas, with DLR's mosaic, Enceladus,
Tethys, Dione, Rhea, Iapetus) and New Horizons (Pluto, Charon). Public domain.
Resampled to 2048 x 1024 equirectangular, centred on longitude 0, east to the
right; the greyscale maps are coloured with a ramp from each moon's real colour
(Pluto's tholins red to its nitrogen ice cream, Iapetus's dark and bright
faces), and the parts never photographed (Pluto's and Charon's south, in
winter darkness during the 2015 flyby) are filled from the moon's own terrain,
mirrored across the equator.

NASA imagery is free to use; NASA asks that it be credited and not used to
imply endorsement (NASA Images and Media Usage Guidelines).
