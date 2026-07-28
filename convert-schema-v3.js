'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createManifest } = require('./lib/manifest.js');
const { writeJsonAtomic } = require('./lib/file-utils.js');
const { toSchemaV3, validateSchemaV3 } = require('./lib/schema-v3.js');
const { generateFileList } = require('./generate-list.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');

function convertAll(options = {}) {
    const rootDir = path.resolve(options.rootDir || ROOT);
    const dataDir = path.resolve(options.dataDir || DATA_DIR);
    const apply = !!options.apply;
    const manifest = createManifest({ rootDir, dataDir });
    const items = [];

    for (const entry of manifest.files) {
        const sourcePath = path.join(rootDir, entry.path);
        const v2 = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
        if (Number(v2.schemaVersion) < 2) {
            items.push({ source: entry.path, status: 'blocked', reason: '源文件不是 schema v2' });
            continue;
        }
        const v3 = toSchemaV3(v2);
        const validation = validateSchemaV3(v2, v3);
        const sourceText = JSON.stringify(v2);
        const targetText = JSON.stringify(v3);
        const targetFile = `${entry.tradingDate}_板块资金流向.v3.json`;
        if (!validation.valid) {
            items.push({ source: entry.path, target: `data/${targetFile}`, status: 'blocked', validation });
            continue;
        }
        if (apply) writeJsonAtomic(path.join(dataDir, targetFile), v3);
        items.push({
            source: entry.path,
            target: `data/${targetFile}`,
            status: apply ? 'converted' : 'ready',
            stocks: Object.keys(v3.股票字典).length,
            sourceBytes: Buffer.byteLength(sourceText),
            targetBytes: Buffer.byteLength(targetText),
            sourceGzipBytes: zlib.gzipSync(sourceText).length,
            targetGzipBytes: zlib.gzipSync(targetText).length
        });
    }

    const totals = items.reduce((sum, item) => {
        for (const key of ['sourceBytes', 'targetBytes', 'sourceGzipBytes', 'targetGzipBytes']) sum[key] += item[key] || 0;
        return sum;
    }, { sourceBytes: 0, targetBytes: 0, sourceGzipBytes: 0, targetGzipBytes: 0 });
    const report = {
        schemaVersion: 1,
        mode: apply ? 'apply' : 'dry-run',
        generatedAt: new Date().toISOString(),
        summary: {
            files: items.length,
            converted: items.filter(item => item.status === 'converted').length,
            ready: items.filter(item => item.status === 'ready').length,
            blocked: items.filter(item => item.status === 'blocked').length,
            ...totals,
            rawReductionPct: totals.sourceBytes ? Number(((1 - totals.targetBytes / totals.sourceBytes) * 100).toFixed(2)) : 0,
            gzipReductionPct: totals.sourceGzipBytes ? Number(((1 - totals.targetGzipBytes / totals.sourceGzipBytes) * 100).toFixed(2)) : 0
        },
        items
    };
    if (apply && report.summary.blocked === 0) generateFileList({ rootDir, dataDir, quiet: true });
    return report;
}

function main() {
    const apply = process.argv.includes('--apply');
    const reportPath = path.join(ROOT, 'outputs', apply ? 'schema-v3-conversion-report.json' : 'schema-v3-conversion-dry-run.json');
    const report = convertAll({ apply });
    writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`报告: ${reportPath}`);
    if (report.summary.blocked > 0) process.exitCode = 2;
}

if (require.main === module) main();
module.exports = { convertAll };
