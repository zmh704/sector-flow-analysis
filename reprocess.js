/**
 * 批量重解析所有源数据Excel文件，覆盖data/中的JSON
 * 用法: node reprocess.js
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { buildAnalysisResult } = require('./analyze.js');

const DATA_DIR = path.join(__dirname, 'data');
const SRC_DIR = path.join(DATA_DIR, '源数据');

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
        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

        const industryRows = result.行业板块资金流向 || [];
        const conceptRows = result.概念板块资金流向 || [];
        console.log(`✅ ${jsonFile} (${industryRows.length}行业, ${conceptRows.length}概念)`);
        count++;
    } catch (err) {
        console.error(`❌ ${file}: ${err.message}`);
    }
}
console.log(`\n已完成 ${count}/${files.length} 个文件`);
