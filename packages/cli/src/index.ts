import { Command } from 'commander'

const program = new Command()
program.name('treeline').description('AI-powered site comprehension engine')

program
  .command('crawl <url>')
  .description('Crawl a site and generate test artifacts, docs, and data')
  .option('--stealth', 'enable hardened stealth acquisition', false)
  .action(async (url: string) => {
    console.log(`treeline crawl not yet implemented: ${url}`)
  })

program.parse()
