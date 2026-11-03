import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `Usage: node scripts/pack-check.mjs [--root <dir>]

Packs the package as npm publish would (npm pack) and checks the tarball
before anyone publishes it (aifactory npm-package template, RQ-0151):

  - it holds nothing outside package.json "files" (npm adds package.json,
    README and LICENSE itself), and none of .env*, src/, tests/,
    requirements/, runs/, handoffs/, references/, constraints/,
    node_modules/;
  - every path "exports", "bin", "main" and "types" name is in it;
  - installed from the .tgz into an empty project, the package imports, and
    each bin prints the package.json version for --version and exits 0
    for --help.

Run it after pnpm build (the build gate runs both). Exit 0 when the
tarball passes, 1 when it does not.`;

// Never in a published package, whatever "files" says.
const FORBIDDEN = ['src/', 'tests/', 'requirements/', 'runs/', 'handoffs/', 'references/', 'constraints/', 'node_modules/'];
// npm puts these in every tarball, whatever "files" says.
const ALWAYS = /^(package\.json|(readme|license|licence)(\.[^/]*)?)$/i;

const normal = (path) => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

// A "files" entry as npm reads it: a directory takes what is under it, a
// glob matches (`*` within a segment, `**` across them).
function filesMatcher(entries) {
  const patterns = entries.map((entry) => {
    const path = normal(entry);
    if (!/[*?]/.test(path)) return (file) => file === path || file.startsWith(path + '/');
    let source = '';
    for (let at = 0; at < path.length; at += 1) {
      if (path.startsWith('**/', at)) {
        source += '(?:.*/)?';
        at += 2;
      } else if (path.startsWith('**', at)) {
        source += '.*';
        at += 1;
      } else if (path[at] === '*') source += '[^/]*';
      else if (path[at] === '?') source += '[^/]';
      else source += path[at].replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    const regex = new RegExp(`^${source}(/.*)?$`);
    return (file) => regex.test(file);
  });
  return (file) => patterns.some((matches) => matches(file));
}

function stringsOf(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/** The bins a package.json declares, by command name. */
export function binsOf(pkg) {
  if (typeof pkg.bin === 'string') return { [pkg.name.replace(/^@[^/]+\//, '')]: pkg.bin };
  return pkg.bin && typeof pkg.bin === 'object' ? pkg.bin : {};
}

/** What is wrong with a tarball's file list, as one line per problem. */
export function listProblems(pkg, files) {
  const problems = [];
  const inFiles = Array.isArray(pkg.files) ? filesMatcher(pkg.files) : () => true;
  for (const file of files.map(normal)) {
    if (file.split('/').some((segment) => segment.startsWith('.env'))) problems.push(`${file}: an env file is never published`);
    else if (FORBIDDEN.some((directory) => file.startsWith(directory))) problems.push(`${file}: ${file.split('/')[0]}/ is never published`);
    else if (!ALWAYS.test(file) && !inFiles(file)) problems.push(`${file}: not in package.json "files"`);
  }
  const named = [
    ...stringsOf(pkg.exports).map((path) => ['exports', path]),
    ...Object.values(binsOf(pkg)).map((path) => ['bin', path]),
    ...['main', 'types', 'typings'].filter((field) => typeof pkg[field] === 'string').map((field) => [field, pkg[field]]),
  ];
  const present = new Set(files.map(normal));
  for (const [field, path] of named) {
    if (path.includes('*')) continue;
    if (!present.has(normal(path))) problems.push(`${normal(path)}: named in "${field}" but not in the tarball`);
  }
  return problems;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return result;
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function packCheck(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const work = mkdtempSync(join(tmpdir(), 'pack-check-'));
  try {
    const packed = run('npm', ['pack', '--json', '--pack-destination', work], { cwd: root });
    if (packed.status !== 0) return [`npm pack failed (exit ${packed.status}): ${(packed.stderr || packed.stdout).trim()}`];
    const [report] = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')));
    const files = report.files.map((file) => file.path);
    console.log(`${report.filename}: ${files.length} file(s), ${kib(report.size)} packed, ${kib(report.unpackedSize)} unpacked`);
    for (const file of report.files) console.log(`  ${file.path} (${kib(file.size)})`);

    const problems = listProblems(pkg, files);
    if (problems.length > 0) return problems;

    // As a user gets it: installed from the tarball into an empty project.
    const user = join(work, 'user');
    mkdirSync(user);
    writeFileSync(join(user, 'package.json'), JSON.stringify({ name: 'pack-check-user', private: true }) + '\n');
    const installed = run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', join(work, report.filename)], { cwd: user });
    if (installed.status !== 0) return [`npm install of the tarball failed (exit ${installed.status}): ${(installed.stderr || installed.stdout).trim()}`];

    if (pkg.exports !== undefined || pkg.main !== undefined) {
      const imported = run(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pkg.name)})`], { cwd: user });
      if (imported.status !== 0) problems.push(`import "${pkg.name}" fails once installed: ${(imported.stderr || imported.stdout).trim().split('\n')[0]}`);
    }
    for (const name of Object.keys(binsOf(pkg))) {
      const bin = join(user, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
      if (!existsSync(bin)) {
        problems.push(`${name}: npm did not link the bin once installed`);
        continue;
      }
      const version = run(bin, ['--version'], { cwd: user });
      if (version.status !== 0) problems.push(`${name} --version exits ${version.status}: ${(version.stderr || version.stdout).trim().split('\n')[0]}`);
      else if (!version.stdout.trim().split(/\s+/).includes(pkg.version)) problems.push(`${name} --version prints "${version.stdout.trim()}", not ${pkg.version} (package.json)`);
      const help = run(bin, ['--help'], { cwd: user });
      if (help.status !== 0) problems.push(`${name} --help exits ${help.status}`);
    }
    return problems;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }
  const at = args.indexOf('--root');
  const root = resolve(at >= 0 ? args[at + 1] : fileURLToPath(new URL('..', import.meta.url)));
  const problems = packCheck(root);
  if (problems.length > 0) {
    console.error(`\npack check failed: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }
  console.log('\npack check passed');
}
