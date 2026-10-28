import { isIP } from 'node:net'

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

export const PRIVATE_IPV4_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10'
] as const
export const PRIVATE_IPV6_RANGES = ['fc00::/7', 'fe80::/10'] as const

export function parseDefaultGateway(routeOutput: string): string {
  for (const line of routeOutput.split(/\r?\n/)) {
    const match = /^default\s+via\s+(\S+)/.exec(line.trim())
    if (match && IPV4_PATTERN.test(match[1])) {
      return match[1]
    }
  }
  throw new Error('Could not read the default gateway inside the sandbox distro (ip route show default).')
}

export function parseNameservers(resolvConf: string): string[] {
  const found: string[] = []
  for (const line of resolvConf.split(/\r?\n/)) {
    const match = /^\s*nameserver\s+(\S+)/.exec(line)
    const address = match?.[1].split('%')[0]
    if (address && isIP(address) !== 0 && !found.includes(address)) {
      found.push(address)
    }
  }
  return found
}

// One nft transaction: add makes delete safe on first run, so repeated calls leave exactly one table.
// Why: loopback first, since replies to the distro's own addresses (even rejects) leave through lo and the stub resolver lives there;
// DNS to remote resolvers is accepted next because they usually sit inside the private ranges.
export function buildFirewallRuleset(gateway: string, nameservers: readonly string[] = []): string {
  if (!IPV4_PATTERN.test(gateway)) {
    throw new Error(`Refusing to build a firewall rule for ${JSON.stringify(gateway)}`)
  }
  const dns4 = nameservers.filter((address) => isIP(address) === 4)
  const dns6 = nameservers.filter((address) => isIP(address) === 6)
  if (dns4.length + dns6.length !== nameservers.length) {
    throw new Error(`Refusing to build a firewall rule for nameservers ${JSON.stringify(nameservers)}`)
  }
  const lines = [
    'add table inet fw',
    'delete table inet fw',
    'table inet fw {',
    '  chain out {',
    '    type filter hook output priority 0; policy accept;',
    '    oifname "lo" accept'
  ]
  if (dns4.length > 0) {
    lines.push(`    ip daddr { ${dns4.join(', ')} } meta l4proto { udp, tcp } th dport 53 accept`)
  }
  if (dns6.length > 0) {
    lines.push(`    ip6 daddr { ${dns6.join(', ')} } meta l4proto { udp, tcp } th dport 53 accept`)
  }
  lines.push(
    `    ip daddr { ${[gateway, ...PRIVATE_IPV4_RANGES].join(', ')} } reject`,
    `    ip6 daddr { ${PRIVATE_IPV6_RANGES.join(', ')} } reject`,
    '  }',
    '}',
    ''
  )
  return lines.join('\n')
}
