// What publish.mjs and verify.mjs agree on.
import { execFileSync } from 'node:child_process';

/** Where approved packages live: the repository's main branch, served raw. */
export const FILES = 'https://raw.githubusercontent.com/cassiel-os/marketplace/main/';
/** A reverse domain and a name (run.cassiel.checkers), as Cassiel's agentd checks it. */
export const ID = /^(?=.{1,80}$)[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){2,}$/;
export const VERSION = /^\d+(\.\d+){0,3}$/;
export const SDK = /^\d+\.\d+$/;
export const CATEGORIES = ['accessories', 'games', 'multimedia', 'internet', 'office', 'development', 'system'];

/** Whether version `a` is newer than `b` ("1.10.0" > "1.9.2"). */
export const isNewer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
};

/** One file out of a .capp (a zip). unzip reads * ? [ ] in names as patterns: escaped. */
export const unzip = (capp, file, encoding = 'utf8') =>
  execFileSync('unzip', ['-p', capp, file.replace(/([*?[\]])/g, '\\$1')], { encoding, maxBuffer: 64 << 20 });
