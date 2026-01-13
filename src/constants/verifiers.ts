// Mapping of verifier addresses to their names
export const VERIFIER_NAMES: Record<string, string> = {
  'axelar15k8d4hqgytdxmcx3lhph2qagvt0r7683cchglj': 'Stakin',
  'axelar16g3c4z0dx3qcplhqfln92p20mkqdj9cr0wyrsh': 'Cosmostation',
  'axelar16ulxkme882pcwpp43rtmz7cxn95x9cqalmas5h': '0base.vc',
  'axelar18mrzfgk63sv455c84gx0p70kl2e329gxnsmgsu': 'Chainlayer',
  'axelar19f26mhy2x488my9pc6wr5x74t4gde8l8scq34g': 'BlockHunters',
  'axelar1d8xyrpwpqgp9m2xuaa8gwhgraqvq8y5unv924h': 'LunaNova',
  'axelar1dqqeuwvpvn2dr7gw7clayshzdemgu7j9cluehl': 'ContributionDAO',
  'axelar1ensvyl4p5gkdmjcezgjd5se5ykxmdqagl67xgm': 'Liquify',
  'axelar1eu4zvmhum66mz7sd82sfnp6w2vfqj06gd4t8f5': 'Validatrium',
  'axelar1g92hckcernmgm60tm527njl6j2cxysm7zg6ulk': 'Quantnode',
  'axelar1hm3qzhevpsfpkxnwz89j9eu6fy8lf36sl6nsd8': 'Enigma',
  'axelar1kaeq00sgqvy65sngedc8dqwxerqzsg2xf7e72z': 'Node.monster',
  'axelar1kr5f2wrq9l2denmvfqfky7f8rd07wk9kygxjak': 'Redbooker',
  'axelar1lkg5zs5zgywc0ua9mpd9d63gdnl3ka9n07r5fg': 'DSRV',
  'axelar1nppclnu328tgvxyvu0fmd6yder3r9mrrgusrj3': 'Encapsulate',
  'axelar1nrk5wk4446342lgcdpjllen4ydc2f2c35h9ynf': 'Chainode Tech',
  'axelar1p0z7ff4wru5yq0v2ny5h6vx5e6ceg06kqnhfpg': 'Axelar',
  'axelar1qgwu4jjgeapqm82w4nslhwlzxa3mjd8fvn4xdx': 'AlexZ',
  'axelar1s2cf963rm0u6kxgker95dh5urmq0utqq3rezdn': 'Inter Blockchain Services',
  'axelar1t23g23u5pcuh9y2stzesf4cx5z3jr66zykkffm': '4SV',
  'axelar1up6evve8slwnflmx0x096klxqh4ufaahsk9y0s': 'Qubelabs',
  'axelar1uu6hl8uvkxjzwpuacaxwvh7ph3qjyragk62n2e': 'P-OPS Team',
  'axelar1wuckkey0xug0547lr3pwnuag79zpns5xt49j9a': 'Figment',
  'axelar1x0a0ylzsjrr57v2ymnsl0d770nt3pwktet9npg': 'Rockaway Infra',
  'axelar1x9qfct58w0yxecmc294k0z39j8fqpa6nzhwwas': 'AutoStake',
  'axelar1ym6xeu9xc8gfu5vh40a0httefxe63j537x5rle': 'Nodiums',
  'axelar1zhazt54ewqhva5pujhfyhr7sf39hm7myatmjtd': 'Brightlystake',
  'axelar1zqnwrhv35cyf65u0059a8rvw8njtqeqjckzhlx': 'Polkachu',
  'axelar1k22ud8g8k7dqx4u5a77gklf6f6exth0u474vt2': 'Imperator',
};

export function getVerifierName(address: string): string | null {
  return VERIFIER_NAMES[address] || null;
}
