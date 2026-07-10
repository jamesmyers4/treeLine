import { renderOutputToHtml, buildRunsIndex } from '../src/index.js'

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (command === 'render') {
    const [outputDir, targetDir] = args
    if (!outputDir || !targetDir) throw new Error('usage: publish.ts render <outputDir> <targetDir>')
    await renderOutputToHtml(outputDir, targetDir)
    return
  }

  if (command === 'index') {
    const [runsRootDir] = args
    if (!runsRootDir) throw new Error('usage: publish.ts index <runsRootDir>')
    await buildRunsIndex(runsRootDir)
    return
  }

  throw new Error(`unknown command: ${command}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
