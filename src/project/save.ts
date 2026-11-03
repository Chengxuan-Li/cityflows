import { sha256 } from './hash';
import { createManifest, type ProjectFile, type SaveMetadata } from './manifest';
import { projectKeys, type Project } from './types';
import { writeZip } from './zip';

async function serializeProject(project: Project, metadata: SaveMetadata) {
  const manifest = createManifest(project.city, metadata);
  const encoder = new TextEncoder();
  const files = projectKeys.flatMap((key) => {
    const value = project[key];
    if (value === undefined) return [];
    const json = JSON.stringify(value);
    return [{ key, json, bytes: encoder.encode(json) }];
  });

  const hashes = await Promise.all(files.map(({ bytes }) => sha256(bytes)));
  files.forEach(({ key }, index) => {
    const file: ProjectFile = `${key}.json`;
    manifest.files[file] = hashes[index]!;
  });

  return { manifest, files, encoder };
}

export async function saveProject(
  project: Project,
  metadata: SaveMetadata = {},
): Promise<Uint8Array> {
  const { manifest, files, encoder } = await serializeProject(project, metadata);
  return writeZip({
    'manifest.json': encoder.encode(JSON.stringify(manifest)),
    ...Object.fromEntries(files.map(({ key, bytes }) => [`${key}.json`, bytes])),
  });
}

export async function saveProjectJson(
  project: Project,
  metadata: SaveMetadata = {},
): Promise<string> {
  const { manifest, files } = await serializeProject(project, metadata);
  // Embed the exact JSON used to compute each digest.
  const members = files.map(({ key, json }) => `"${key}":${json}`);
  return `{"manifest":${JSON.stringify(manifest)},${members.join(',')}}`;
}
