import { unzipSync, zipSync } from 'fflate';

export function writeZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
