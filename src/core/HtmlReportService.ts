import fs from 'fs';
import path from 'path';
import { Step, Scenario } from '../types/index.js';

export class HtmlReportService {
  private reportDir: string;

  constructor(reportDir: string = './reports') {
    this.reportDir = reportDir;
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  public generateReport(scenario: Scenario, steps: Step[], isSuccess: boolean): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const scenarioName = scenario.name || scenario.Name || 'Test Scenario';
    const fileName = `report_${scenarioName.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.html`;
    const filePath = path.join(this.reportDir, fileName);

    const totalDuration = steps.reduce((acc, s) => acc + (s.durationMs || 0), 0);
    const passedCount = steps.filter((s) => s.status === 'Passed').length;
    const failedCount = steps.filter((s) => s.status === 'Failed').length;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Synaptix Test Report - ${scenarioName}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent-pass: #22c55e;
      --accent-fail: #ef4444;
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
      max-width: 1000px;
      margin: 0 auto;
    }
    .header {
      background: var(--card-bg);
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid var(--border);
      margin-bottom: 2rem;
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
    .step-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .error-box {
      background: rgba(239, 68, 68, 0.1);
      border-left: 4px solid var(--accent-fail);
      padding: 0.75rem;
      margin-top: 0.75rem;
      font-family: monospace;
      font-size: 0.875rem;
      color: #fca5a5;
    }
    img.screenshot {
      max-width: 100%;
      border-radius: 6px;
      margin-top: 0.75rem;
      border: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Synaptix AI Test Report</h1>
      <h2>${scenarioName}</h2>
      <div>
        <span class="status-badge ${isSuccess ? 'pass' : 'fail'}">
          ${isSuccess ? 'PASSED' : 'FAILED'}
        </span>
        <span style="margin-left: 1rem; color: var(--text-muted);">
          Duration: ${(totalDuration / 1000).toFixed(2)}s | Passed: ${passedCount} | Failed: ${failedCount}
        </span>
      </div>
    </div>

    <h3>Step Details</h3>
    ${steps
      .map(
        (step, idx) => `
      <div class="step-card">
        <div class="step-header">
          <strong>Step ${idx + 1}: ${step.name || step.action}</strong>
          <span class="status-badge ${step.status === 'Passed' ? 'pass' : 'fail'}">${step.status} (${step.durationMs}ms)</span>
        </div>
        ${step.errorMessage ? `<div class="error-box">${step.errorMessage}</div>` : ''}
        ${step.screenshotPath ? `<img class="screenshot" src="${step.screenshotPath}" alt="Step Screenshot" />` : ''}
      </div>
    `
      )
      .join('')}
  </div>
</body>
</html>
    `;

    fs.writeFileSync(filePath, htmlContent, 'utf-8');
    return filePath;
  }
}
