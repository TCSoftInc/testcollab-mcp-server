import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function parseVersion(version) {
  const cleanVersion = version.split('-')[0];
  const parts = cleanVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return parts;
}

function compare(v1, v2) {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);
  for (let i = 0; i < 3; i += 1) {
    if (p1[i] > p2[i]) return 1;
    if (p1[i] < p2[i]) return -1;
  }
  return 0;
}

function bumpMinor(version) {
  const [maj, min] = parseVersion(version);
  return `${maj}.${min + 1}.0`;
}

function bumpPatch(version) {
  const [maj, min, pat] = parseVersion(version);
  return `${maj}.${min}.${pat + 1}`;
}

function npmView(pkg, token) {
  if (!token) {
    try {
      const v = execSync(`npm view ${pkg} version`, { encoding: 'utf8' }).trim();
      console.log(`Latest published version for ${pkg}: ${v}`);
      return v;
    } catch (error) {
      console.log(`Could not fetch version from npm for ${pkg} (might not exist yet).`);
      return undefined;
    }
  }

  const tmpRc = path.join(os.tmpdir(), `.npmrc-${Date.now()}-${Math.random()}`);
  try {
    fs.writeFileSync(tmpRc, `//registry.npmjs.org/:_authToken=${token}\n`, 'utf8');
    const v = execSync(`npm view ${pkg} version --userconfig ${tmpRc}`, { encoding: 'utf8' }).trim();
    console.log(`Latest published version for ${pkg} (auth): ${v}`);
    return v;
  } catch (error) {
    console.log(`Could not fetch version from npm for ${pkg} with auth (might not exist yet).`);
    return undefined;
  } finally {
    try {
      fs.unlinkSync(tmpRc);
    } catch (_) {
      // ignore cleanup errors
    }
  }
}

function readJson(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function writeJson(jsonPath, data) {
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
}

function updateLockFile(lockPath, newVersion) {
  if (!fs.existsSync(lockPath)) return;

  const lockJson = readJson(lockPath);

  if (lockJson.version) {
    lockJson.version = newVersion;
  }

  if (lockJson.packages && lockJson.packages['']) {
    lockJson.packages[''].version = newVersion;
  }

  writeJson(lockPath, lockJson);
  console.log(`package-lock.json updated to ${newVersion}`);
}

try {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const lockPath = path.join(rootDir, 'package-lock.json');

  const packageJson = readJson(packageJsonPath);
  const packageName = packageJson.name;
  const localVersion = packageJson.version;
  console.log(`Local package.json version: ${localVersion}`);

  const publishedVersion = npmView(packageName, process.env.NPM_TOKEN);
  const knownPublished = [publishedVersion].filter(Boolean);

  let baseVersion = localVersion;
  for (const version of knownPublished) {
    if (compare(version, baseVersion) === 1) {
      baseVersion = version;
    }
  }

  let newVersion;
  const localIsHighest = knownPublished.every(
    (version) => !version || compare(localVersion, version) === 1,
  );

  if (localIsHighest) {
    newVersion = localVersion;
    console.log(`Local version (${localVersion}) is highest; keeping it.`);
  } else {
    newVersion = bumpMinor(baseVersion);
    console.log(`Auto-incrementing minor from ${baseVersion} to ${newVersion}`);
  }

  const publishedSet = new Set(knownPublished);
  while (publishedSet.has(newVersion)) {
    const bumped = bumpPatch(newVersion);
    console.log(`Version ${newVersion} already published; bumping patch to ${bumped}`);
    newVersion = bumped;
  }

  if (newVersion !== localVersion) {
    packageJson.version = newVersion;
    writeJson(packageJsonPath, packageJson);
    console.log(`package.json updated to ${newVersion}`);
  } else {
    console.log('package.json version already at desired value; no change needed.');
  }

  updateLockFile(lockPath, newVersion);
} catch (error) {
  console.error('Error bumping version:', error);
  process.exit(1);
}
