import fs from 'fs';
import path from 'path';
import { Step, Scenario } from '../types/index.js';

export interface MasterReportScenarioResult {
  file: string;
  scenario: Scenario;
  steps: Step[];
  isSuccess: boolean;
}

export class HtmlReportService {
  private reportDir: string;

  constructor(reportDir: string = './reports') {
    this.reportDir = reportDir;
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  public generateMasterReport(tagOrName: string, results: MasterReportScenarioResult[]): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedTitle = tagOrName.replace(/^@/, '').replace(/[^a-z0-9]/gi, '_');
    const fileName = `report_${sanitizedTitle}_${timestamp}.html`;
    const filePath = path.join(this.reportDir, fileName);

    const totalScenarios = results.length;
    const passedScenarios = results.filter((r) => r.isSuccess).length;
    const failedScenarios = totalScenarios - passedScenarios;
    const passRate = totalScenarios > 0 ? Math.round((passedScenarios / totalScenarios) * 100) : 0;

    const totalDurationMs = results.reduce((acc, r) => {
      const sceneDuration = r.steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);
      return acc + sceneDuration;
    }, 0);

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Synaptix Test Execution Report - ${tagOrName}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent-pass: #22c55e;
      --accent-fail: #ef4444;
      --accent-primary: #3b82f6;
      --border: #334155;
    }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    .header {
      background: var(--card-bg);
      padding: 2rem;
      border-radius: 12px;
      border: 1px solid var(--border);
      margin-bottom: 2rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-top: 1.5rem;
    }
    .stat-card {
      background: rgba(15, 23, 42, 0.6);
      padding: 1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      text-align: center;
    }
    .stat-value {
      font-size: 1.75rem;
      font-weight: bold;
      margin-top: 0.25rem;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-weight: bold;
      font-size: 0.875rem;
    }
    .status-badge.pass { background-color: rgba(34, 197, 94, 0.2); color: var(--accent-pass); }
    .status-badge.fail { background-color: rgba(239, 68, 68, 0.2); color: var(--accent-fail); }
    
    details.scenario-block {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 1.25rem;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    summary.scenario-header {
      padding: 1.25rem 1.5rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      list-style: none;
      background: var(--card-bg);
    }
    summary.scenario-header::-webkit-details-marker {
      display: none;
    }
    summary.scenario-header:hover {
      background: #273549;
    }
    .chevron {
      display: inline-block;
      transition: transform 0.2s ease;
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-right: 0.5rem;
    }
    details[open] summary .chevron {
      transform: rotate(90deg);
    }
    .step-list-container {
      padding: 1rem 1.5rem 1.5rem 1.5rem;
      border-top: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.35);
    }
    .step-list {
      padding-left: 0;
      list-style: none;
      margin: 0;
    }
    .step-item {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .error-box {
      background: rgba(239, 68, 68, 0.1);
      border-left: 4px solid var(--accent-fail);
      padding: 0.75rem;
      margin-top: 0.5rem;
      margin-bottom: 0.75rem;
      font-family: monospace;
      font-size: 0.875rem;
      color: #fca5a5;
      border-radius: 0 4px 4px 0;
    }
    img.screenshot {
      max-width: 100%;
      border-radius: 6px;
      margin-top: 0.5rem;
      margin-bottom: 1rem;
      border: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">🚀 Synaptix E2E Test Report</h1>
      <p style="color: var(--text-muted); font-size: 1.1rem; margin-top: 0.25rem;">
        Execution Scope: <strong style="color: var(--accent-primary);">${tagOrName}</strong>
      </p>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div style="color: var(--text-muted); font-size: 0.875rem;">Total Scenarios</div>
          <div class="stat-value">${totalScenarios}</div>
        </div>
        <div class="stat-card">
          <div style="color: var(--text-muted); font-size: 0.875rem;">Passed</div>
          <div class="stat-value" style="color: var(--accent-pass);">${passedScenarios}</div>
        </div>
        <div class="stat-card">
          <div style="color: var(--text-muted); font-size: 0.875rem;">Failed</div>
          <div class="stat-value" style="color: var(--accent-fail);">${failedScenarios}</div>
        </div>
        <div class="stat-card">
          <div style="color: var(--text-muted); font-size: 0.875rem;">Pass Rate</div>
          <div class="stat-value">${passRate}%</div>
        </div>
        <div class="stat-card">
          <div style="color: var(--text-muted); font-size: 0.875rem;">Total Duration</div>
          <div class="stat-value">${(totalDurationMs / 1000).toFixed(1)}s</div>
        </div>
      </div>
    </div>

    <h2 style="margin-bottom: 1rem;">Scenarios (${results.length})</h2>
    ${results
      .map((r, sIdx) => {
        const name = r.scenario.name || r.scenario.Name || r.file;
        const sceneDuration = (r.steps.reduce((sum, s) => sum + (s.durationMs || 0), 0) / 1000).toFixed(2);
        const scenePassedSteps = r.steps.filter((s) => s.status === 'Passed').length;
        const isCollapsedByDefault = r.isSuccess ? '' : 'open';

        return `
      <details class="scenario-block" ${isCollapsedByDefault}>
        <summary class="scenario-header">
          <div style="display: flex; align-items: center;">
            <span class="chevron">▶</span>
            <div>
              <h3 style="margin: 0; display: inline-block; font-size: 1.1rem;">${sIdx + 1}. ${name}</h3>
              <span style="color: var(--text-muted); font-size: 0.875rem; margin-left: 0.5rem;">(${r.file})</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 1rem;">
            <span class="status-badge ${r.isSuccess ? 'pass' : 'fail'}">
              ${r.isSuccess ? 'PASSED' : 'FAILED'}
            </span>
            <span style="color: var(--text-muted); font-size: 0.875rem;">
              ${scenePassedSteps}/${r.steps.length} steps (${sceneDuration}s)
            </span>
          </div>
        </summary>

        <div class="step-list-container">
          <ul class="step-list">
            ${r.steps
              .map(
                (step, idx) => `
              <li class="step-item">
                <div>
                  <strong>Step ${idx + 1}:</strong> ${step.name || step.action}
                </div>
                <span class="status-badge ${step.status === 'Passed' ? 'pass' : 'fail'}">
                  ${step.status} (${step.durationMs}ms)
                </span>
              </li>
              ${step.errorMessage ? `<div class="error-box">${step.errorMessage}</div>` : ''}
              ${step.screenshotPath ? `<img class="screenshot" src="${step.screenshotPath}" alt="Step Screenshot" />` : ''}
            `
              )
              .join('')}
          </ul>
        </div>
      </details>
        `;
      })
      .join('')}
  </div>
</body>
</html>
    `;

    fs.writeFileSync(filePath, htmlContent, 'utf-8');
    return filePath;
  }
}
