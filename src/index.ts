import fs from 'fs';
import path from 'path';
import parseYaml from 'yaml';
import dotenv from 'dotenv';
import { TestRunner } from './core/TestRunner.js';
import { Scenario } from './types/index.js';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  let tagFilter: string | null = null;
  let targetFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--tag=') || arg.startsWith('-t=')) {
      tagFilter = arg.split('=')[1].replace(/^@/, '').trim().toLowerCase();
    } else if (arg === '--tag' || arg === '-t') {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        tagFilter = nextArg.replace(/^@/, '').trim().toLowerCase();
        i++;
      } else {
        console.error(`⚠️  Warning: The --tag option requires a value (e.g. --tag smoke1 or --tag "@smoke1").`);
        process.exit(1);
      }
    } else if (!arg.startsWith('-')) {
      targetFile = arg;
    }
  }

  console.log(`\n💎 SynaptixTS E2E Test Engine`);

  const runner = new TestRunner();

  if (tagFilter) {
    console.log(`🏷️  Filtering scenarios by tag: "@${tagFilter}"`);
    const scenariosDir = path.resolve('scenarios');

    if (!fs.existsSync(scenariosDir)) {
      console.error(`❌ Scenarios directory not found at: ${scenariosDir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    const matchingScenarios: { file: string; scenario: Scenario }[] = [];

    for (const file of files) {
      const filePath = path.join(scenariosDir, file);
      try {
        const rawYaml = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseYaml.parse(rawYaml) as any;
        
        let rawTags: any = parsed?.tags || parsed?.Tags || [];
        if (typeof rawTags === 'string') {
          rawTags = rawTags.split(',').map((t: string) => t.trim());
        }
        
        const tags: string[] = Array.isArray(rawTags)
          ? rawTags.map((t: any) => String(t).replace(/^@/, '').trim().toLowerCase())
          : [];

        if (tags.includes(tagFilter)) {
          matchingScenarios.push({ file, scenario: parsed as Scenario });
        }
      } catch (err: any) {
        console.warn(`   ⚠️ Could not parse scenario file ${file}: ${err.message}`);
      }
    }

    if (matchingScenarios.length === 0) {
      console.log(`⚠️  No scenarios found matching tag "@${tagFilter}" in scenarios/ directory.`);
      process.exit(0);
    }

    console.log(`🚀 Found ${matchingScenarios.length} matching scenario(s):`);
    matchingScenarios.forEach(m => console.log(`   • ${m.file} (${m.scenario.name || m.scenario.Name || 'Unnamed'})`));
    console.log('');

    let allPassed = true;

    for (const { file, scenario } of matchingScenarios) {
      console.log(`📁 Executing: ${file}`);
      const success = await runner.runScenario(scenario);
      if (!success) allPassed = false;
    }

    if (allPassed) {
      console.log(`\n🎉 All tagged scenarios passed successfully!`);
      process.exit(0);
    } else {
      console.error(`\n❌ One or more tagged scenarios failed.`);
      process.exit(1);
    }
  } else {
    // If no specific file provided, pick first available .yaml file in scenarios/
    let scenarioFile = targetFile;
    if (!scenarioFile) {
      const scenariosDir = path.resolve('scenarios');
      if (fs.existsSync(scenariosDir)) {
        const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        if (files.length > 0) {
          scenarioFile = path.join('scenarios', files[0]);
        }
      }
    }

    if (!scenarioFile) {
      console.error(`❌ No scenario files (.yaml) found in scenarios/ directory.`);
      process.exit(1);
    }

    const fullPath = path.resolve(scenarioFile);

    if (!fs.existsSync(fullPath)) {
      console.error(`❌ Scenario file not found at: ${fullPath}`);
      process.exit(1);
    }

    console.log(`📁 Loading scenario: ${scenarioFile}`);

    try {
      const rawYaml = fs.readFileSync(fullPath, 'utf-8');
      const parsedScenario = parseYaml.parse(rawYaml) as Scenario;
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
}

main();
