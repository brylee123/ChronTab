import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const rootPackage = resolve('package.json');
const visited = new Set();
const notices = new Map();

function packageFile(name, fromPackage) {
  const require = createRequire(fromPackage);
  try {
    return require.resolve(name + '/package.json');
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      throw error;
    }
  }

  let folder = dirname(require.resolve(name));
  while (folder !== dirname(folder)) {
    const candidate = join(folder, 'package.json');
    if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === name) {
      return candidate;
    }
    folder = dirname(folder);
  }
  throw new Error('Cannot locate package metadata for ' + name);
}

function collect(file) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const identity = pkg.name + '@' + pkg.version;
  if (visited.has(identity)) {
    return;
  }
  visited.add(identity);
  const folder = dirname(file);
  const licenses = readdirSync(folder)
    .filter(
      (name) =>
        /^(license|licence|copying|notice)(\.|$)/i.test(name) &&
        statSync(join(folder, name)).isFile(),
    )
    .sort();
  const text = licenses.length
    ? licenses.map((name) => readFileSync(join(folder, name), 'utf8')).join('\n')
    : 'Declared license: ' + (pkg.license || 'not specified') + '\n' + (pkg.homepage || '');
  notices.set(identity, identity + '\n' + '='.repeat(identity.length) + '\n' + text);
  visitDependencies(pkg, file);
}

function visitDependencies(pkg, fromPackage) {
  const optional = pkg.optionalDependencies || {};
  for (const name of Object.keys({ ...pkg.dependencies, ...optional }).sort()) {
    let file;
    try {
      file = packageFile(name, fromPackage);
    } catch (error) {
      // Optional platform-specific dependencies may be absent from this installation.
      if (Object.hasOwn(optional, name) && error.code === 'MODULE_NOT_FOUND') {
        continue;
      }
      throw error;
    }
    collect(file);
  }
}

visitDependencies(JSON.parse(readFileSync(rootPackage, 'utf8')), rootPackage);
const heading =
  'Chrontab bundles the following runtime dependencies. These notices retain their upstream licenses and attributions. Development tools are excluded because their code is not shipped in the extension.\n';
const output = [
  heading,
  ...[...notices].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text),
].join('\n\n');
writeFileSync('THIRD_PARTY_NOTICES.txt', output.replace(/\r\n/g, '\n') + '\n');
console.log('Retained notices for ' + notices.size + ' runtime dependencies.');
