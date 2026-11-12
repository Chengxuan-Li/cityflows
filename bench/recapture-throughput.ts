import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { sourceRequestKey } from '../tests/routing/throughput-fixtures';

// TASK-144: generate the complete control sample from the clean parent, never from the patch.
const expectedParent = 'fa8c621ec4075d54eef52071c5aaf62cf5f2acbf';
const [parentArg, outputArg] = process.argv.slice(2);
if (!parentArg || !outputArg)
  throw new Error('Usage: recapture-throughput <clean-parent-root> <output.json>');
const parent = resolve(parentArg);
const output = resolve(outputArg);
const actualParent = execFileSync('git', ['-C', parent, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actualParent !== expectedParent) throw new Error(`Expected clean parent ${expectedParent}`);
if (execFileSync('git', ['-C', parent, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim())
  throw new Error('The control checkout must be clean');
const recorded = JSON.parse(readFileSync('tests/routing/throughput-routes.json', 'utf8')) as Record<string, Record<string, string[] | string>>;
const fixture = await import(pathToFileURL(resolve(parent, 'tests/routing/throughput-fixtures.ts')).href) as typeof import('../tests/routing/throughput-fixtures');
const routing = await import(pathToFileURL(resolve(parent, 'src/routing/index.ts')).href) as typeof import('../src/routing');
const working = process.cwd();
process.chdir(parent);
const { city, net } = fixture.throughputFixture('Munich');
const requests = fixture.throughputRequests(net);
const provider = routing.createRouteProvider();
const costs = routing.freeFlowLinkCosts(net);
recorded.Munich = Object.fromEntries(requests.map(({ key, request }) => {
  const result = provider.route(net, costs, request);
  return [sourceRequestKey(city, net, key, request), result.ok ? result.route.roads.map((i) => net.roads[i]!.id) : result.reason];
}));
process.chdir(working);
const text = `${JSON.stringify(recorded, null, 2)}\n`;
writeFileSync(output, text);
console.info({ parent: actualParent, requests: requests.length, output, sha256: createHash('sha256').update(text).digest('hex') });
