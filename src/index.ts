import fs from 'fs';
import path from 'path';
import parseYaml from 'yaml';
import dotenv from 'dotenv';
import { TestRunner } from './core/TestRunner.js';
import { HtmlReportService, MasterReportScenarioResult } from './core/HtmlReportService.js';
import { Scenario } from './types/index.js';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  let tagFilter: string | null = null;
  let targetFile: string | null = null;
  let isAll = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i].trim();
    if (arg === '--all' || arg === '-a') {
      isAll = true;
    } else if (arg.startsWith('--tag=') || arg.startsWith('-t=')) {
      tagFilter = arg.split('=')[1].replace(/^@/, '').trim().toLowerCase();
    } else if (arg === '--tag' || arg === '-t') {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        tagFilter = nextArg.replace(/^@/, '').trim().toLowerCase();
        i++;
      } else {
        console.error(`⚠️  Warning: The --tag option requires a value (e.g. --tag smoke or --tag checkout).`);
        process.exit(1);
      }
    } else if (arg.startsWith('@')) {
      tagFilter = arg.replace(/^@/, '').trim().toLowerCase();
    } else if (arg.endsWith('.yaml') || arg.endsWith('.yml')) {
      targetFile = arg;
    } else if (arg.startsWith('--') && arg.length > 2) {
      // Auto-handle shorthand flags like --checkout, --login, --smoke, --negative
      tagFilter = arg.replace(/^--/, '').trim().toLowerCase();
    } else if (!arg.startsWith('-')) {
      const candidateFile = path.resolve('scenarios', arg.endsWith('.yaml') ? arg : `${arg}.yaml`);
      if (fs.existsSync(candidateFile)) {
        targetFile = candidateFile;
      } else {
        tagFilter = arg.toLowerCase();
      }
    }
  }

  console.log(`\n💎 SynaptixTS E2E Test Engine`);

  const runner = new TestRunner();
  const scenariosDir = path.resolve('scenarios');

  if (!fs.existsSync(scenariosDir)) {
    console.error(`❌ Scenarios directory not found at: ${scenariosDir}`);
    process.exit(1);
  }

  const allYamlFiles = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

  // Batch execution helper
  const runBatch = async (scenariosList: { file: string; scenario: Scenario }[], title: string) => {
    console.log(`🚀 Found ${scenariosList.length} matching scenario(s):`);
    scenariosList.forEach(m => console.log(`   • ${m.file} (${m.scenario.name || m.scenario.Name || 'Unnamed'})`));
    console.log('');

    const batchResults: MasterReportScenarioResult[] = [];
    let allPassed = true;
    const suiteStartTime = Date.now();

    for (const { file, scenario } of scenariosList) {
      console.log(`📁 Executing: ${file}`);
      const details = await runner.runScenarioDetails(scenario);
      batchResults.push({
        file,
        scenario,
        steps: details.steps,
        isSuccess: details.success
      });
      if (!details.success) allPassed = false;
    }

    const suiteDuration = ((Date.now() - suiteStartTime) / 1000).toFixed(1);
    const passedCount = batchResults.filter(r => r.isSuccess).length;
    const failedCount = batchResults.length - passedCount;
    const passRate = Math.round((passedCount / batchResults.length) * 100);

    console.log(`\n================================================================================`);
    console.log(`📊 SYNAPTIX TEST EXECUTION SUMMARY (${title})`);
    console.log(`================================================================================`);
    batchResults.forEach(r => {
      const icon = r.isSuccess ? '✅ PASSED' : '❌ FAILED';
      const name = r.scenario.name || r.scenario.Name || r.file;
      const passedSteps = r.steps.filter(s => s.status === 'Passed').length;
      const sceneDuration = (r.steps.reduce((acc, s) => acc + (s.durationMs || 0), 0) / 1000).toFixed(1);
      console.log(`${icon} | ${name} (${passedSteps}/${r.steps.length} steps, ${sceneDuration}s) - ${r.file}`);
    });
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Total Scenarios: ${batchResults.length} | Passed: ${passedCount} | Failed: ${failedCount} | Pass Rate: ${passRate}% | Total Suite Time: ${suiteDuration}s`);
    console.log(`================================================================================\n`);

    const reporter = new HtmlReportService();
    const masterReportPath = reporter.generateMasterReport(title, batchResults);
    console.log(`🏆 Single Master HTML Report Generated: ${masterReportPath}\n`);

    if (allPassed) {
      console.log(`🎉 All scenarios passed successfully!`);
      process.exit(0);
    } else {
      console.error(`❌ One or more scenarios failed.`);
      process.exit(1);
    }
  };

  // 1. Tag-filtered Execution
  if (tagFilter) {
    console.log(`🏷️  Filtering scenarios by tag: "@${tagFilter}"`);

    const matchingScenarios: { file: string; scenario: Scenario }[] = [];

    for (const file of allYamlFiles) {
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

    await runBatch(matchingScenarios, `@${tagFilter}`);
    return;
  }

  // 2. Run All Scenarios (when isAll or npm run test:all with no specific file)
  if (isAll || (!targetFile && args.length === 0)) {
    console.log(`🚀 Running ALL scenarios in scenarios/ directory:`);

    const allScenarios: { file: string; scenario: Scenario }[] = [];
    for (const file of allYamlFiles) {
      const filePath = path.join(scenariosDir, file);
      try {
        const rawYaml = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseYaml.parse(rawYaml) as Scenario;
        allScenarios.push({ file, scenario: parsed });
      } catch (err: any) {
        console.warn(`   ⚠️ Could not parse scenario file ${file}: ${err.message}`);
      }
    }

    if (allScenarios.length === 0) {
      console.error(`❌ No valid scenario files (.yaml) found in scenarios/ directory.`);
      process.exit(1);
    }

    await runBatch(allScenarios, 'Full Suite');
    return;
  }

  // 3. Single Specific Scenario Execution
  const scenarioFile = targetFile || path.join('scenarios', allYamlFiles[0]);
  const fullPath = path.resolve(scenarioFile);

  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Scenario file not found at: ${fullPath}`);
    process.exit(1);
  }

  console.log(`📁 Loading scenario: ${path.basename(scenarioFile)}`);

  try {
    const rawYaml = fs.readFileSync(fullPath, 'utf-8');
    const parsedScenario = parseYaml.parse(rawYaml) as Scenario;
    const details = await runner.runScenarioDetails(parsedScenario);

    const reporter = new HtmlReportService();
    const sceneTitle = parsedScenario.name || parsedScenario.Name || path.basename(scenarioFile);
    const reportPath = reporter.generateMasterReport(sceneTitle, [
      { file: path.basename(scenarioFile), scenario: parsedScenario, steps: details.steps, isSuccess: details.success }
    ]);

    console.log(`\n🏆 Single HTML Report Generated: ${reportPath}`);

    if (!details.success) {
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
