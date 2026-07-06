import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const cliBundle = resolve(root, 'dist-cli/zmakebas.js')
const outDir = resolve(root, 'dist-exe')
const executableName = process.env.ZMAKEBAS_EXE_NAME ?? (platform() === 'win32' ? 'zmakebas.exe' : 'zmakebas')
const executablePath = resolve(outDir, executableName)
const seaConfigPath = resolve(outDir, 'sea-config.json')

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

async function main() {
  if (!existsSync(cliBundle)) {
    throw new Error('Missing dist-cli/zmakebas.js. Run npm run build:cli before building the executable.')
  }

  await mkdir(outDir, { recursive: true })

  await writeFile(
    seaConfigPath,
    `${JSON.stringify(
      {
        main: cliBundle,
        mainFormat: 'module',
        output: executablePath,
        disableExperimentalSEAWarning: true,
        useCodeCache: false,
        useSnapshot: false,
      },
      null,
      2,
    )}\n`,
  )

  run(process.execPath, ['--build-sea', seaConfigPath], {
    unsupportedHint:
      'This Node.js version does not support direct SEA builds. Use Node.js 26 or newer, or run the GitHub Actions binary workflow.',
  })

  if (platform() === 'darwin') {
    run('codesign', ['--sign', '-', executablePath])
  }

  if (platform() !== 'win32') {
    await chmod(executablePath, 0o755)
  }

  console.log(`Built ${basename(executablePath)} for ${platform()}-${arch()} at ${executablePath}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status === 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
    return
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (options.unsupportedHint && /bad option|unknown option|invalid option|--build-sea/i.test(output)) {
    throw new Error(`${options.unsupportedHint}\n${output}`)
  }

  throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : '.'}`)
}
