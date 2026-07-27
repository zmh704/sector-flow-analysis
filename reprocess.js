/**
 * 批量重解析所有源数据Excel文件，覆盖data/中的JSON
 * 用法: node reprocess.js
 *
 * 当同一日期有多个源文件时（新旧格式并存），优先保留含最高价/开盘价/最低价/收盘价的新格式数据。
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { buildAnalysisResult, detectColumns } = require('./analyze.js');
const { generateFileList } = require('./generate-list.js');
const { getHasPriceData } = require('./lib/manifest.js');
const { writeJsonAtomic } = require('./lib/file-utils.js');

const DATA_DIR = path.join(__dirname, 'data');
const SRC_DIR = path.join(DATA_DIR, '源数据');

/** 判断Excel文件是否包含最高价/开盘价/最低价/收盘价列（新格式） */
function hasPriceColumns(workbook) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rows.length === 0) return false;
    const colMap = detectColumns(rows);
    return !!(colMap.high && colMap.open && colMap.low && colMap.close);
}

/** 判断已有JSON是否包含价格数据（检查涉及股票字符串中是否有9个|分隔部分） */
function jsonHasPriceData(jsonPath) {
    try {
        return getHasPriceData(JSON.parse(fs.readFileSync(jsonPath, 'utf-8')));
    } catch {
        return false;
    }
}

// 处理所有源数据文件
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.xlsx'));
let count = 0;
for (const file of files) {
    try {
        const filePath = path.join(SRC_DIR, file);
        const workbook = XLSX.readFile(filePath);
        const result = buildAnalysisResult(workbook, file);
        const tradingDate = result.交易日期;
        if (!tradingDate) {
            console.log(`跳过(无可识别交易日期): ${file}`);
            continue;
        }

        const jsonFile = `${tradingDate}_板块资金流向.json`;
        const jsonPath = path.join(DATA_DIR, jsonFile);

        // 判断当前文件是否为新格式（含价格数据）
        const isNewFormat = hasPriceColumns(workbook);

        // 如果JSON已存在且已有价格数据，而当前文件是旧格式 → 跳过（保留已有价格数据）
        if (fs.existsSync(jsonPath) && !isNewFormat && jsonHasPriceData(jsonPath)) {
            console.log(`⏭️ ${jsonFile} 已有价格数据，跳过旧格式: ${file}`);
            continue;
        }

        writeJsonAtomic(jsonPath, result);

        const industryRows = result.行业板块资金流向 || [];
        const conceptRows = result.概念板块资金流向 || [];
        const tag = isNewFormat ? '📊' : '✅';
        console.log(`${tag} ${jsonFile} (${industryRows.length}行业, ${conceptRows.length}概念) ${isNewFormat ? '[含价格数据]' : ''}`);
        count++;
    } catch (err) {
        console.error(`❌ ${file}: ${err.message}`);
    }
}
console.log(`\n已完成 ${count}/${files.length} 个文件`);
try {
    generateFileList({ quiet: true });
    console.log('已同步生成 v2 list.json');
} catch (error) {
    console.error('生成 list.json 失败:', error.message);
}
