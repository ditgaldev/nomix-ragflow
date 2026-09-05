import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'nomix-ragflow-pack-'))
const environment = {
  ...process.env,
  npm_config_cache: join(directory, 'npm-cache'),
}
const npm = process.platform === 'win32' ? process.execPath : 'npm'
const npmArguments = process.platform === 'win32'
  ? [process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  : []

try {
  const output = execFileSync(npm, [...npmArguments, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  })
  const result = JSON.parse(output)
  const filename = result[0]?.filename
  if (typeof filename !== 'string') throw new Error('npm pack did not return a tarball filename')
  const tarball = join(directory, filename)
  for (const script of ['audit-tarball.mjs', 'verify-consumer.mjs', 'verify-profile.mjs']) {
    execFileSync(process.execPath, [join(root, 'scripts', script), tarball], {
      cwd: root,
      stdio: 'inherit',
      env: environment,
    })
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
