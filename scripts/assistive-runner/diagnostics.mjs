/** Observation only: no process arguments, readiness timeouts or screen-reader protocol are changed. */
import childProcess from 'node:child_process';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { platform, release, arch } from 'node:os';
const LIMIT = 96000;
const tracked = /(?:^|\/)(?:speech-dispatcher|at-spi-bus-launcher|dbus-daemon|Xvfb|orca)$/;
export function observeDaemonLifecycle() {
  const original = childProcess.spawn;
  const events = []; let bytes = 0, dropped = 0;
  const record = (event) => {
    const row = { at: new Date().toISOString(), ...event };
    const size = Buffer.byteLength(JSON.stringify(row));
    if (bytes + size > LIMIT) { dropped++; return; }
    bytes += size; events.push(row);
  };
  childProcess.spawn = function(command, args, options) {
    const child = original.call(this, command, args, options);
    if (tracked.test(command)) {
      record({ kind: 'spawn', command, args, pid: child.pid, socket: options?.env?.GUIDEPUP_ORCA_SPEECH_SOCKET ?? null });
      child.stdout?.on('data', chunk => record({ kind: 'stdout', command, pid: child.pid, text: chunk.toString().slice(0, 12000) }));
      child.stderr?.on('data', chunk => record({ kind: 'stderr', command, pid: child.pid, text: chunk.toString().slice(0, 12000) }));
      child.on('error', error => record({ kind: 'process-error', command, pid: child.pid, error: String(error) }));
      child.on('exit', (code, signal) => record({ kind: 'exit', command, pid: child.pid, code, signal }));
    }
    return child;
  };
  return { record, restore() { childProcess.spawn = original; }, async failure() {
    const files = [], seen = new Set(); let logBytes = 0;
    for (const major of ['6', '7']) {
      const root = `/root/.cache/guidepup/orca/${major}`;
      for (const version of await readdir(root).catch(() => [])) {
        const directory = `${root}/${version}/extracted/speechd/logs`;
        for (const file of await readdir(directory).catch(() => [])) {
          const path = `${directory}/${file}`, resolved = await realpath(path).catch(() => path);
          if (seen.has(resolved) || logBytes >= LIMIT) continue; seen.add(resolved);
          const value = await readFile(path).catch(() => null); if (!value) continue;
          const tail = value.subarray(Math.max(0, value.length - Math.min(24000, LIMIT - logBytes))).toString('utf8'); logBytes += Buffer.byteLength(tail);
          files.push({ path, bytes: value.length, tail });
        }
      }
    }
    const resources = {};
    for (const file of ['/proc/loadavg', '/proc/meminfo', '/proc/self/limits']) resources[file] = (await readFile(file, 'utf8').catch(() => 'unavailable')).slice(0, 10000);
    return { schema: 'passage.at-failure-diagnostics/v2', platform: `${platform()}/${arch()} ${release()}`, events, bytes, dropped, speechDispatcherLogs: files, resources,
      limitation: 'Transparent process observers retain failures. No retry, daemon argument, socket path, readiness timeout or keyboard protocol change.' };
  } };
}
