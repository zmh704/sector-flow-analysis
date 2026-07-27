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
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const sectors = data.行业板块资金流向 || data.概念板块资金流向 || [];
        for (const s of sectors) {
            if (s.涉及股票) {
                const firstStock = s.涉及股票.split(',')[0];
                const m = firstStock.match(/\(([^)]+)\)/);
                if (m && m[1].split('|').length >= 8) return true;
            }
        }
    } catch {}
    return false;
}

// 处理所有源数据文件
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.xlsx'));
let count = 0;
for (const file of files) {
    try {
        const filePath = path.join(SRC_DIR, file);
        const workbook = XLSX.readFile(filePath);
        const result = buildAnalysisResult(workbook, file);
        const baseName = path.basename(file, path.extname(file));
        const dateMatch = baseName.match(/(\d{1,2}月\d{1,2}日)/);
        const datePart = dateMatch ? dateMatch[1] : '';

        if (!datePart) {
            console.log(`跳过(无日期): ${file}`);
            continue;
        }

        const jsonFile = `${datePart}_板块资金流向.json`;
        const jsonPath = path.join(DATA_DIR, jsonFile);

        // 判断当前文件是否为新格式（含价格数据）
        const isNewFormat = hasPriceColumns(workbook);

        // 如果JSON已存在且已有价格数据，而当前文件是旧格式 → 跳过（保留已有价格数据）
        if (fs.existsSync(jsonPath) && !isNewFormat && jsonHasPriceData(jsonPath)) {
            console.log(`⏭️ ${jsonFile} 已有价格数据，跳过旧格式: ${file}`);
            continue;
        }

        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

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
