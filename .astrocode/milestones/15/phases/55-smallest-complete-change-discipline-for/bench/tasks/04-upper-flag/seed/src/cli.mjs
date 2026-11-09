const USAGE = 'usage: greet [--name <value>] [--help]'

export function run(argv) {
  if (argv.includes('--help')) return USAGE
  const i = argv.indexOf('--name')
  const name = i >= 0 && argv[i + 1] ? argv[i + 1] : 'world'
  return `Hello, ${name}!`
}
