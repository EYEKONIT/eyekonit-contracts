import { run, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const manifestPath = process.env.DEPLOYMENT_MANIFEST || 'deployments/polygon-v2.2.json';
  const deployment = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
  if (deployment.chainId !== network.config.chainId) throw new Error('Verification network differs from release manifest');
  let failures = 0;
  for (const [name, contract] of Object.entries(deployment.deploymentTransactions) as [string, any][]) {
    try {
      await run('verify:verify', { address: contract.address, constructorArguments: contract.constructorArguments });
      console.log(`${name}: source verified`);
    } catch (error: any) {
      if (/already verified/i.test(error.message)) console.log(`${name}: already verified`);
      else { failures++; console.error(`${name}: ${error.message}`); }
    }
  }
  if (failures) throw new Error(`${failures} contract sources remain unverified`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
