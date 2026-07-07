function parseRobotsTxt(text: string): (path: string) => boolean {
  const disallowed: string[] = []
  const groups = text.split(/\n\s*\n/)
  for (const group of groups) {
    const lines = group
      .split('\n')
      .map((l) => l.split('#')[0].trim())
      .filter(Boolean)
    const isStarGroup = lines.some((l) => /^user-agent\s*:\s*\*$/i.test(l))
    if (!isStarGroup) continue
    for (const line of lines) {
      const m = line.match(/^disallow\s*:\s*(.+)$/i)
      if (m) disallowed.push(m[1].trim())
    }
  }
  return (path: string) => !disallowed.some((d) => path.startsWith(d))
}

export async function fetchRobotsRules(origin: string): Promise<(path: string) => boolean> {
  try {
    const res = await fetch(`${origin}/robots.txt`)
    if (!res.ok) return () => true
    const text = await res.text()
    return parseRobotsTxt(text)
  } catch {
    return () => true
  }
}
