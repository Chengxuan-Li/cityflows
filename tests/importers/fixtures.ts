const files = import.meta.glob<string>('../../fixtures/osm/*.osm', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function fixture(name: 'downtown' | 'highway' | 'suburb' | 'munich-donnersberger') {
  const xml = files[`../../fixtures/osm/${name}.osm`];
  if (!xml) throw new Error(`Missing OSM fixture ${name}`);
  return { xml, options: { importerVersion: 'test' } };
}
