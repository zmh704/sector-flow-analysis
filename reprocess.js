'use strict';

/**
 * 将历史 schema v1 JSON 按其“数据来源”Excel 安全迁移为 schema v2。
 *
 * 默认只演练，不写数据：node reprocess.js
 * 确认并应用迁移：    node reprocess.js --apply
 * 指定报告路径：      node reprocess.js --apply --report outputs/migration-report.json
 *
 * 迁移采用新增 ISO 文件名，不删除或覆盖旧的中文日期 JSON；manifest 会优先选择 v2/ISO 文件。
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { buildAnalysisResult } = require('./analyze.js');
const { generateFileList } = require('./generate-list.js');
const { writeJsonAtomic } = require('./lib/file-utils.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const SRC_DIR = path.join(DATA_DIR, '源数据');
const GROUP_KEYS = ['行业板块资金流向', '概念板块资金流向'];

function parseArgs(argv) {
    const args = { apply: false, reportPath: path.join(ROOT, 'outputs', 'schema-v2-migration-report.json') };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--apply') args.apply = true;
        else if (arg === '--dry-run') args.apply = false;
        else if (arg === '--report') {
            if (!argv[index + 1]) throw new Error('--report 后必须提供文件路径');
            args.reportPath = path.resolve(ROOT, argv[++index]);
        } else {
            throw new Error(`不支持的参数: ${arg}`);
        }
    }
    return args;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function summarizeGroup(data, key) {
    const rows = Array.isArray(data?.[key]) ? data[key] : [];
    return {
        sectors: rows.length,
        stockCount: rows.reduce((sum, row) => sum + Number(row.股票数量 || 0), 0),
        turnover: rows.reduce((sum, row) => sum + Number(row.成交额 || 0), 0),
        net: rows.reduce((sum, row) => sum + Number(row.主力净额 || 0), 0)
    };
}

function isKnownDuplicateCorrection(oldRow, newRow) {
    return String(oldRow.涉及股票 || '') === String(newRow.涉及股票 || '')
        && Number(oldRow.股票数量) === Number(newRow.股票数量) * 2
        && Number(oldRow.成交额) === Number(newRow.成交额) * 2
        && Number(oldRow.主力净额) === Number(newRow.主力净额) * 2;
}

function compareGroup(oldData, newData, key) {
    const oldRows = Array.isArray(oldData?.[key]) ? oldData[key] : [];
    const newRows = Array.isArray(newData?.[key]) ? newData[key] : [];
    const newByName = new Map(newRows.map(row => [row.板块, row]));
    const differences = [];

    for (const oldRow of oldRows) {
        const newRow = newByName.get(oldRow.板块);
        if (!newRow) {
            differences.push({ sector: oldRow.板块, type: 'missing-in-new' });
            continue;
        }
        newByName.delete(oldRow.板块);
        const fields = ['成交额', '主力净额', '股票数量'].filter(field =>
            Number(oldRow[field]) !== Number(newRow[field])
        );
        if (fields.length > 0) {
            differences.push({
                sector: oldRow.板块,
                type: isKnownDuplicateCorrection(oldRow, newRow) ? 'duplicate-correction' : 'value-change',
                fields,
                old: Object.fromEntries(fields.map(field => [field, oldRow[field]])),
                new: Object.fromEntries(fields.map(field => [field, newRow[field]]))
            });
        }
    }
    for (const sector of newByName.keys()) differences.push({ sector, type: 'new-sector' });

    return {
        old: summarizeGroup(oldData, key),
        new: summarizeGroup(newData, key),
        differences
    };
}

function compareResults(oldData, newData) {
    const groups = Object.fromEntries(GROUP_KEYS.map(key => [key, compareGroup(oldData, newData, key)]));
    const differences = Object.values(groups).flatMap(group => group.differences);
    const unsafe = differences.filter(item => item.type !== 'duplicate-correction');
    return {
        safe: unsafe.length === 0,
        classification: differences.length === 0 ? 'exact' : unsafe.length === 0 ? 'duplicate-correction' : 'incompatible',
        groups
    };
}

function listLegacyJsonFiles(dataDir) {
    return fs.readdirSync(dataDir)
        .filter(name => name.endsWith('.json') && name !== 'list.json')
        .map(name => ({ name, path: path.join(dataDir, name) }))
        .filter(file => {
            try { return Number(readJson(file.path).schemaVersion || 1) < 2; }
            catch { return false; }
        });
}

function migrateOne(file, options) {
    const oldData = readJson(file.path);
    const sourceName = oldData.数据来源;
    const sourcePath = sourceName ? path.join(options.srcDir, sourceName) : '';
    const base = { legacyFile: file.name, source: sourceName || null };
    if (!sourceName || !fs.existsSync(sourcePath)) {
        return { ...base, status: 'blocked', reason: '缺少原始 Excel' };
    }

    try {
        const result = buildAnalysisResult(XLSX.readFile(sourcePath), sourceName, { silent: true });
        const diagnostics = result.解析诊断;
        const validation = compareResults(oldData, result);
        const targetFile = `${result.交易日期}_板块资金流向.json`;
        const targetPath = path.join(options.dataDir, targetFile);
        const existing = fs.existsSync(targetPath) ? readJson(targetPath) : null;

        if (diagnostics.skippedRows > 0 || diagnostics.conflictRows > 0) {
            return {
                ...base, targetFile, status: 'blocked', reason: '新解析仍有跳过或冲突行', diagnostics, validation
            };
        }
        if (!validation.safe) {
            return { ...base, targetFile, status: 'blocked', reason: '迁移前后出现非预期口径差异', diagnostics, validation };
        }
        if (existing && Number(existing.schemaVersion) >= 2) {
            return {
                ...base, targetFile, status: 'already-v2', diagnostics, validation,
                existingSource: existing.数据来源 || null
            };
        }
        if (options.apply) writeJsonAtomic(targetPath, result);
        return {
            ...base,
            targetFile,
            status: options.apply ? 'migrated' : 'ready',
            diagnostics,
            validation,
            bytes: Buffer.byteLength(JSON.stringify(result), 'utf8')
        };
    } catch (error) {
        return { ...base, status: 'blocked', reason: error.message, code: error.code || 'MIGRATION_ERROR' };
    }
}

function runMigration(options = {}) {
    const config = {
        apply: !!options.apply,
        rootDir: path.resolve(options.rootDir || ROOT),
        dataDir: path.resolve(options.dataDir || DATA_DIR),
        srcDir: path.resolve(options.srcDir || SRC_DIR),
        reportPath: path.resolve(options.reportPath || path.join(ROOT, 'outputs', 'schema-v2-migration-report.json'))
    };
    const files = listLegacyJsonFiles(config.dataDir);
    const items = files.map(file => migrateOne(file, config));
    const report = {
        schemaVersion: 1,
        mode: config.apply ? 'apply' : 'dry-run',
        generatedAt: new Date().toISOString(),
        summary: {
            legacyFiles: items.length,
            ready: items.filter(item => item.status === 'ready').length,
            migrated: items.filter(item => item.status === 'migrated').length,
            alreadyV2: items.filter(item => item.status === 'already-v2').length,
            blocked: items.filter(item => item.status === 'blocked').length,
            duplicateCorrections: items.filter(item => item.validation?.classification === 'duplicate-correction').length
        },
        items
    };

    writeJsonAtomic(config.reportPath, report);
    if (config.apply && report.summary.blocked === 0) generateFileList({ rootDir: config.rootDir, dataDir: config.dataDir, quiet: true });
    return report;
}

function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const report = runMigration(options);
        console.log(JSON.stringify(report.summary, null, 2));
        console.log(`${report.mode === 'apply' ? '迁移' : '演练'}报告: ${options.reportPath}`);
        if (report.summary.blocked > 0) process.exitCode = 2;
    } catch (error) {
        console.error('迁移失败:', error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    parseArgs,
    summarizeGroup,
    isKnownDuplicateCorrection,
    compareGroup,
    compareResults,
    listLegacyJsonFiles,
    migrateOne,
    runMigration
};
