import type { City, MarkingThemeId } from './city';

/** Coarse offline regions, deliberately limited to the task's supported countries. */
export function geographicMarkingTheme(geo: City['geo'] | undefined): MarkingThemeId {
  if (!geo) return 'de';
  const [west, south, east, north] = geo.bbox;
  const lon = (west + east) / 2,
    lat = (south + north) / 2;
  const within = (w: number, s: number, e: number, n: number) =>
    lon >= w && lon <= e && lat >= s && lat <= n;
  if (within(-11, 49.8, 2, 61)) return 'uk';
  if (
    within(-125, 24, -66, 49.5) ||
    within(-141, 41.5, -52, 84) ||
    within(-180, 51, -130, 72) ||
    within(-161, 18, -154, 23)
  )
    return 'us';
  return 'de';
}

export function cityMarkingTheme(
  city?: Pick<City, 'markingTheme'> & { geo?: City['geo'] },
): MarkingThemeId {
  return city?.markingTheme ?? geographicMarkingTheme(city?.geo);
}
