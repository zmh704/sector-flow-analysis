'use strict';

const { normalizeStock } = require('../stock-utils.js');

const GROUP_KEYS = ['行业板块资金流向', '概念板块资金流向'];

function compactStock(detail) {
    const stock = normalizeStock(detail);
    return {
        stockKey: stock.stockKey,
        name: stock.name,
        code: stock.code,
        amountText: stock.amount,
        netText: stock.net,
        changeText: stock.change,
        volumeText: stock.volume,
        amountYi: stock.amountYi,
        netYi: stock.netYi,
        changePct: stock.changePct,
        volumeWanShou: stock.volumeWanShou,
        high: stock.high,
        open: stock.open,
        low: stock.low,
        close: stock.close
    };
}

function toSchemaV3(data) {
    if (!data || typeof data !== 'object') throw new TypeError('数据必须是对象');
    if (Number(data.schemaVersion) >= 3 && data.股票字典) return data;

    const dictionary = Object.create(null);
    const result = { ...data, schemaVersion: 3, 股票字典: dictionary };
    for (const key of GROUP_KEYS) {
        const rows = Array.isArray(data[key]) ? data[key] : [];
        result[key] = rows.map(row => {
            const details = Array.isArray(row.股票明细) ? row.股票明细 : [];
            const stockKeys = [];
            for (const detail of details) {
                const stock = compactStock(detail);
                if (!stock.name || !stock.stockKey) continue;
                if (!dictionary[stock.stockKey]) dictionary[stock.stockKey] = stock;
                stockKeys.push(stock.stockKey);
            }
            const compactRow = { ...row, 股票键: stockKeys };
            delete compactRow.股票明细;
            delete compactRow.涉及股票;
            return compactRow;
        });
    }
    return result;
}

function validateSchemaV3(v2, v3) {
    const errors = [];
    const dictionary = v3?.股票字典;
    if (!dictionary || typeof dictionary !== 'object') errors.push('缺少股票字典');
    for (const key of GROUP_KEYS) {
        const left = Array.isArray(v2?.[key]) ? v2[key] : [];
        const right = Array.isArray(v3?.[key]) ? v3[key] : [];
        if (left.length !== right.length) errors.push(`${key}板块数不一致`);
        for (let index = 0; index < Math.min(left.length, right.length); index++) {
            const oldRow = left[index];
            const newRow = right[index];
            if (oldRow.板块 !== newRow.板块) errors.push(`${key}[${index}]板块顺序不一致`);
            if (Number(oldRow.股票数量) !== newRow.股票键.length) errors.push(`${key}/${oldRow.板块}股票数不一致`);
            for (const stockKey of newRow.股票键) {
                if (!dictionary?.[stockKey]) errors.push(`${key}/${oldRow.板块}缺少股票 ${stockKey}`);
            }
        }
    }
    return { valid: errors.length === 0, errors };
}

module.exports = { GROUP_KEYS, compactStock, toSchemaV3, validateSchemaV3 };
