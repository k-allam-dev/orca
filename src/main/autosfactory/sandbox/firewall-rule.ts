const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

export function parseDefaultGateway(routeOutput: string): string {
  for (const line of routeOutput.split(/\r?\n/)) {
    const match = /^default\s+via\s+(\S+)/.exec(line.trim())
    if (match && IPV4_PATTERN.test(match[1])) {
      return match[1]
    }
  }
  throw new Error('Could not read the default gateway inside the sandbox distro (ip route show default).')
}

// One nft transaction: add makes delete safe on first run, so repeated calls leave exactly one rule.
export function buildFirewallRuleset(gateway: string): string {
  if (!IPV4_PATTERN.test(gateway)) {
    throw new Error(`Refusing to build a firewall rule for ${JSON.stringify(gateway)}`)
  }
  return [
    'add table inet fw',
    'delete table inet fw',
    'table inet fw {',
    '  chain out {',
    '    type filter hook output priority 0; policy accept;',
    `    ip daddr ${gateway} reject`,
    '  }',
    '}',
    ''
  ].join('\n')
}
