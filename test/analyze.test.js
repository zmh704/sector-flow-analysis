const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const {
    analyzeFundFlow,
    buildAnalysisResult,
    parseNumericValue,
    normalizeStockCode,
    buildStockKey,
    extractTradeDate,
    detectColumns
} = require('../analyze.js');

function workbookFromRows(rows) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Sheet1');
    return workbook;
}

function baseRow(overrides = {}) {
    return {
        '股票简称': '浦发银行',
        '股票代码': '600000',
        '行业板块': '银行',
        '概念板块': '沪股通',
        '主力净额': '1亿元',
        '成交额': '2亿元',
        ...overrides
    };
}

test('严格数值解析支持 number、千分位、元/万/亿和百分比', () => {
    assert.equal(parseNumericValue(1234.5), 1234.5);
    assert.equal(parseNumericValue('1,234.50元'), 1234.5);
    assert.equal(parseNumericValue('-2.5万'), -25000);
    assert.equal(parseNumericValue('+1.25亿元'), 125000000);
    assert.equal(parseNumericValue('12.5%'), 12.5);

    for (const invalid of ['1,23元', '12abc', '1.2万亿元', '', Infinity]) {
        assert.throws(() => parseNumericValue(invalid), /无效数值/);
    }
});

test('列识别不允许短列名反向匹配或同一物理列重复占用', () => {
    const columns = detectColumns([{
        '股票简称': '样例',
        '行业': '银行',
        '概念': '沪股通',
        '额': 1
    }]);
    assert.equal(columns.net, undefined);
    assert.equal(columns.turnover, undefined);
});

test('列识别在多个物理列同时匹配同一逻辑字段时明确报错', () => {
    assert.throws(() => detectColumns([{
        '股票简称': '样例',
        '所属行业': '银行',
        '所属概念': '沪股通',
        '主力净额(元)': 1,
        '主力净额(万元)': 2,
        '成交额': 3
    }]), /列识别存在歧义/);
});

test('股票代码规范化并按市场生成 stockKey，无效代码回退 legacy key', () => {
    assert.equal(normalizeStockCode(1), '000001');
    assert.equal(normalizeStockCode('600000.0'), '600000');
    assert.equal(normalizeStockCode('SH.688001'), '688001');
    assert.equal(buildStockKey('600000', '浦发银行'), 'SH:600000');
    assert.equal(buildStockKey('000001', '平安银行'), 'SZ:000001');
    assert.equal(buildStockKey('430047', '诺思兰德'), 'BJ:430047');
    assert.equal(buildStockKey('123456', '  测试　股票  '), 'legacy:name:测试 股票');
    assert.equal(buildStockKey('', '  测试　股票  '), 'legacy:name:测试 股票');
});

test('旧模板产出旧涉及股票和新增股票明细，列名单位参与换算', () => {
    const workbook = workbookFromRows([baseRow({
        '股票代码': 1,
        '主力净额': '12,345万元',
        '成交额': 250000000,
        '成交量(手)': '12,000',
        '涨跌幅(%)': '3.5%'
    })]);

    const { industryRows, conceptRows } = analyzeFundFlow(workbook);
    assert.equal(industryRows.length, 1);
    assert.equal(conceptRows.length, 1);
    const sector = industryRows[0];
    assert.equal(sector['成交额'], 250000000);
    assert.equal(sector['主力净额'], 123450000);
    assert.equal(sector['股票数量'], 1);
    assert.equal(sector['涉及股票'], '浦发银行(000001|2.50亿|+1.23亿|+3.50%|1万手)');
    assert.deepEqual(sector['股票明细'][0], {
        stockKey: 'SZ:000001',
        name: '浦发银行',
        code: '000001',
        amountText: '2.50亿',
        netText: '+1.23亿',
        changeText: '+3.50%',
        volumeText: '1万手',
        amountYi: 2.5,
        netYi: 1.2345,
        changePct: 3.5,
        volumeWanShou: 1.2,
        high: null,
        open: null,
        low: null,
        close: null,
        avg5: null,
        avg10: null
    });
});

test('新模板产出 OHLC 明细和兼容涉及股票格式', () => {
    const workbook = workbookFromRows([baseRow({
        '股票简称': '科创样本',
        '股票代码': '688001.SH',
        '主力净额': '-5,000万',
        '成交额': '3.2亿',
        '成交量': '2万手',
        '涨跌幅': '-1.25%',
        '最高价.前复权': '12.8',
        '开盘价.前复权': 12.2,
        '最低价.前复权': '11.9',
        '收盘价.前复权': '12.0'
    })]);

    const sector = analyzeFundFlow(workbook).industryRows[0];
    const detail = sector['股票明细'][0];
    assert.equal(detail.stockKey, 'SH:688001');
    assert.equal(detail.amountYi, 3.2);
    assert.equal(detail.netYi, -0.5);
    assert.equal(detail.volumeWanShou, 2);
    assert.equal(detail.changePct, -1.25);
    assert.deepEqual([detail.high, detail.open, detail.low, detail.close], [12.8, 12.2, 11.9, 12]);
    assert.equal(
        sector['涉及股票'],
        '科创样本(688001|3.20亿|-5000.00万|-1.25%|2万手|12.8|12.2|11.9|12)'
    );
});

test('双层表头的第2行日期元数据被整体忽略，不作为错误数据行', () => {
    const workbook = workbookFromRows([
        {
            '股票简称': '股票简称',
            '股票代码': '股票代码',
            '行业板块': '行业板块',
            '概念板块': '概念板块',
            '主力净额': '2026.07.28',
            '成交额': '2026.07.28',
            '成交量(手)': '2026.07.28',
            '涨跌幅(%)': '涨跌幅(%)'
        },
        baseRow({ '成交量(手)': 12000, '涨跌幅(%)': 1.5 })
    ]);

    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const { industryRows } = analyzeFundFlow(workbook);
        assert.equal(industryRows.length, 1);
        assert.equal(industryRows[0]['股票数量'], 1);
        assert.deepEqual(errors, []);
    } finally {
        console.error = originalError;
    }
});

test('真实数据行即使名称碰巧等于列名，非法日期数值仍会报错并跳过', () => {
    const workbook = workbookFromRows([{
        '股票简称': '股票简称',
        '股票代码': '600000',
        '行业板块': '银行',
        '概念板块': '沪股通',
        '主力净额': '2026.07.28',
        '成交额': '2亿元'
    }]);
    assert.equal(analyzeFundFlow(workbook).industryRows.length, 0);
});

test('同一板块完全重复行仅合并一次，聚合金额、数量和列表一致', () => {
    const row = baseRow({ '行业板块': '银行, 银行', '概念板块': '沪股通' });
    const { industryRows, conceptRows } = analyzeFundFlow(workbookFromRows([row, { ...row }]));

    for (const sector of [industryRows[0], conceptRows[0]]) {
        assert.equal(sector['成交额'], 200000000);
        assert.equal(sector['主力净额'], 100000000);
        assert.equal(sector['股票数量'], 1);
        assert.equal(sector['股票明细'].length, 1);
        assert.equal(sector['涉及股票'].split(', ').length, 1);
    }
});

test('同一 stockKey 字段冲突时记录诊断，保留第一条数据', () => {
    const workbook = workbookFromRows([
        baseRow(),
        baseRow({ '主力净额': '2亿元' })
    ]);

    const { industryRows, diagnostics } = analyzeFundFlow(workbook, { silent: true });
    assert.equal(industryRows.length, 1);
    assert.equal(industryRows[0]['主力净额'], 100000000);
    assert.equal(industryRows[0]['股票数量'], 1);
    assert.equal(diagnostics.acceptedRows, 1);
    assert.equal(diagnostics.skippedRows, 1);
    assert.equal(diagnostics.conflictRows, 1);
    assert.equal(diagnostics.errors[0].code, 'STOCK_CONFLICT');
});

test('buildAnalysisResult 遇到冲突行或没有有效行时阻止生成结果', () => {
    assert.throws(() => buildAnalysisResult(workbookFromRows([
        baseRow(),
        baseRow({ '主力净额': '2亿元' })
    ]), '2026-07-28.xlsx', { silent: true }), error => {
        assert.equal(error.code, 'CONFLICT_ROWS');
        assert.equal(error.diagnostics.conflictRows, 1);
        return true;
    });

    assert.throws(() => buildAnalysisResult(
        workbookFromRows([baseRow({ '主力净额': '不是数字' })]),
        '2026-07-28.xlsx',
        { silent: true }
    ), error => {
        assert.equal(error.code, 'NO_VALID_ROWS');
        assert.equal(error.diagnostics.acceptedRows, 0);
        return true;
    });
});

test('单行数值非法时跳过该行，返回空结果', () => {
    assert.equal(analyzeFundFlow(workbookFromRows([baseRow({ '主力净额': '不是数字' })])).industryRows.length, 0);
    assert.equal(analyzeFundFlow(workbookFromRows([baseRow({ '成交额': '' })])).industryRows.length, 0);
    assert.equal(analyzeFundFlow(workbookFromRows([baseRow({ '成交额': '2026.07.28' })])).industryRows.length, 0);
});

test('buildAnalysisResult 增加 schemaVersion、来源日期和解析诊断并保持旧调用兼容', () => {
    const workbook = workbookFromRows([baseRow()]);
    const isoResult = buildAnalysisResult(workbook, '资金流向_2026-07-26.xlsx');
    assert.equal(isoResult.schemaVersion, 2);
    assert.equal(isoResult['交易日期'], '2026-07-26');
    assert.equal(isoResult['数据来源'], '资金流向_2026-07-26.xlsx');
    assert.deepEqual(isoResult['解析诊断'], {
        totalRows: 1,
        acceptedRows: 1,
        skippedRows: 0,
        duplicateRows: 0,
        conflictRows: 0,
        metadataRows: 0,
        errors: []
    });

    assert.equal(extractTradeDate('资金流向_2025年2月3日.xlsx'), '2025-02-03');
    assert.equal(extractTradeDate('2月3日_资金流向.xlsx', { referenceYear: 2024 }), '2024-02-03');
    assert.equal(extractTradeDate('资金流向.xlsx', { referenceYear: 2024 }), null);
    assert.equal(extractTradeDate('2025-02-30.xlsx'), null);
});
