// Optional lab-only snapshots. Never open a formal game save or database.
import { constants } from 'node:fs';
import { open, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, basename, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { pattern, earlyMs, lateMs } from './protocol.mjs';

const format = 'pixelpet-rhythm-observations', version = 1, maxBytes = 256 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const invalid = () => { throw new Error('Invalid or incompatible rhythm snapshot; left unchanged.'); };
const snapshot = (sessions, port) => ({ format, version, port, sessions: [...sessions.values()].map(({ state }) => ({
  id: state.id, sequence: state.sequence, observations: state.observations,
})) });

export function decodeSnapshot(value, port) {
  if (!exact(value, ['format', 'version', 'port', 'sessions']) || value.format !== format
    || value.version !== version || value.port !== port || !Array.isArray(value.sessions)
    || value.sessions.length > 32) invalid();
  const ids = new Set();
  return value.sessions.map(state => {
    if (!exact(state, ['id', 'sequence', 'observations']) || typeof state.id !== 'string' || !uuid.test(state.id)
      || ids.has(state.id) || !Number.isSafeInteger(state.sequence) || state.sequence < 0
      || !Array.isArray(state.observations) || state.observations.length > pattern.length) invalid();
    ids.add(state.id);
    let sequence = 0;
    for (const [index, observation] of state.observations.entries()) {
      if (!exact(observation, ['sequence', 'expected', 'key', 'directionMatches', 'arrivalDeltaMs', 'arrival'])
        || !Number.isSafeInteger(observation.sequence) || observation.sequence <= sequence
        || observation.sequence > state.sequence || observation.expected !== pattern[index]
        || !['A', 'B'].includes(observation.key)
        || observation.directionMatches !== (observation.expected === observation.key)
        || !Number.isFinite(observation.arrivalDeltaMs)
        || observation.arrival !== (observation.arrivalDeltaMs < -earlyMs ? 'early'
          : observation.arrivalDeltaMs > lateMs ? 'late' : 'inside')) invalid();
      sequence = observation.sequence;
    }
    return { ...state, status: state.observations.length === pattern.length ? 'done' : 'paused', cue: null };
  });
}

// Caller must already own the fixed loopback port, and keep it until exit.
// The snapshot's bound port excludes other ports; wx claims a new file once.
export async function openStore(path, port) {
  if (!path) return null;
  if (!isAbsolute(path) || !Number.isSafeInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Rhythm snapshots require an absolute external path and a fixed port.');
  }
  const parent = await realpath(dirname(path));
  const repo = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const within = relative(repo, parent);
  if (!within || (!isAbsolute(within) && within !== '..' && !within.startsWith(`..${sep}`))) {
    throw new Error('Rhythm snapshots must stay outside the repository.');
  }
  path = join(parent, basename(path));
  const syncDirectory = async () => {
    const directory = await open(parent, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  };
  let states;
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(snapshot(new Map(), port))); await file.sync(); }
    finally { await file.close(); }
    await syncDirectory();
    states = [];
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes) invalid();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await file.stat();
      if (!current.isFile() || current.nlink !== 1 || current.size > maxBytes) invalid();
      states = decodeSnapshot(JSON.parse(await file.readFile('utf8')), port);
    } finally { await file.close(); }
  }
  return {
    states,
    async save(sessions) {
      const data = JSON.stringify(snapshot(sessions, port));
      if (Buffer.byteLength(data) > maxBytes) invalid();
      const temp = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
      const file = await open(temp, 'wx', 0o600);
      try {
        try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
        await rename(temp, path);
        await syncDirectory();
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
  };
}
