export type WslConf = Map<string, Map<string, string>>

export const REQUIRED_WSL_CONF: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  automount: { enabled: 'false', mountFsTab: 'false' },
  interop: { enabled: 'false', appendWindowsPath: 'false' }
}

export function parseWslConf(text: string): WslConf {
  const conf: WslConf = new Map()
  let section: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      section = conf.get(header[1]) ?? new Map()
      conf.set(header[1], section)
      continue
    }
    const eq = line.indexOf('=')
    if (section && eq > 0) {
      section.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
    }
  }
  return conf
}

export function missingWslConfSettings(conf: WslConf): string[] {
  const missing: string[] = []
  for (const [section, keys] of Object.entries(REQUIRED_WSL_CONF)) {
    for (const [key, value] of Object.entries(keys)) {
      if (conf.get(section)?.get(key)?.toLowerCase() !== value) {
        missing.push(`${section}.${key}=${value}`)
      }
    }
  }
  return missing
}

export function withRequiredWslConf(conf: WslConf): WslConf {
  const next: WslConf = new Map([...conf].map(([name, keys]) => [name, new Map(keys)]))
  for (const [section, keys] of Object.entries(REQUIRED_WSL_CONF)) {
    const target = next.get(section) ?? new Map<string, string>()
    for (const [key, value] of Object.entries(keys)) {
      target.set(key, value)
    }
    next.set(section, target)
  }
  return next
}

export function serializeWslConf(conf: WslConf): string {
  const blocks = [...conf].map(([name, keys]) => {
    const lines = [...keys].map(([key, value]) => `${key}=${value}`)
    return [`[${name}]`, ...lines].join('\n')
  })
  return `${blocks.join('\n\n')}\n`
}
