import fs from 'fs';
import path from 'path';
import parseYaml from 'yaml';
import dotenv from 'dotenv';
import { TestRunner } from './core/TestRunner.js';
import { Scenario } from './types/index.js';

// Load environment variables from .env
dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const scenarioFile = args[0] || 'scenarios/demo.yaml';

  const fullPath = path.resolve(scenarioFile);

  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Scenario file not found at: ${fullPath}`);
    process.exit(1);
  }

  console.log(`\n💎 SynaptixTS E2E Test Engine`);
  console.log(`📁 Loading scenario: ${scenarioFile}`);

  try {
    const rawYaml = fs.readFileSync(fullPath, 'utf-8');
    const parsedScenario = parseYaml.parse(rawYaml) as Scenario;

    const runner = new TestRunner();
    const success = await runner.runScenario(parsedScenario);

    if (!success) {
      console.error(`\n❌ Scenario Failed.`);
      process.exit(1);
    } else {
      console.log(`\n🎉 Scenario Passed Successfully!`);
      process.exit(0);
    }
  } catch (err: any) {
    console.error(`\n💥 Execution error: ${err.message}`);
    process.exit(1);
  }
}

main();
