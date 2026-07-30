'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

test('页面关键 DOM 和脚本加载顺序完整', () => {
    const html = read('index.html');
    const requiredIds = [
        'dateButtons', 'industryChart', 'conceptChart', 'leaderContent', 'focusContent',
        'modalOverlay', 'trendModalOverlay', 'stockPanelList', 'loadStatus'
    ];
    for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`));

    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1].split('?')[0]);
    const expected = ['chart.umd.min.js', 'config.js', 'stock-utils.js', 'calc.js', 'data.js', 'charts.js', 'leaders.js', 'modals.js', 'app.js'];
    let previous = -1;
    for (const script of expected) {
        const index = scripts.indexOf(script);
        assert.ok(index > previous, `${script} 加载顺序错误或缺失`);
        previous = index;
    }
});

test('主图柱条点击打开对应板块详情', () => {
    const charts = read('charts.js');
    assert.match(charts, /onClick: function\(event, elements, chart\)/);
    assert.match(charts, /elements\.find\(item => item\.datasetIndex === 0\)/);
    assert.match(charts, /function getSectorRowIndex\(event, chart\)/);
    assert.match(charts, /getSectorRowIndex\(event, chart\)/);
    assert.match(charts, /openFocusSector\(item\.板块, dataType\)/);
    assert.match(charts, /\$sectorDataType = dataType/);
});

test('TradingView 行情脚本按需加载，不阻塞主页面', () => {
    const html = read('index.html');
    const modals = read('modals.js');
    assert.doesNotMatch(html, /s3\.tradingview\.com\/tv\.js/);
    assert.match(modals, /function ensureTradingViewLoaded\(\)/);
    assert.match(modals, /script\.async = true/);
    assert.match(modals, /ensureTradingViewLoaded\(\)\.then/);
});

test('页面不再包含内联事件处理器', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test('原页面日期选择仅展示最近10日并彻底隐藏滚动条', () => {
    const html = read('index.html');
    const config = read('config.js');
    const data = read('data.js');
    const css = read('style.css');
    const app = read('app.js');
    assert.match(html, /style\.css\?v=20260729-0930/);
    assert.match(html, /app\.js\?v=20260729-0930/);
    assert.match(html, /id="dateButtons" style="overflow:hidden;scrollbar-width:none;"/);
    assert.match(config, /const DATE_BUTTON_LIMIT = 10;/);
    assert.match(data, /sorted\.slice\(-DATE_BUTTON_LIMIT\)/);
    const selectorRule = css.match(/\.date-selector\s*\{([\s\S]*?)\}/)?.[1] || '';
    const legacyButtonsRule = css.match(/\.date-buttons\s*\{([\s\S]*?)\}/)?.[1] || '';
    assert.match(selectorRule, /display:\s*grid/);
    assert.match(selectorRule, /grid-template-columns:\s*repeat\(10, minmax\(0, 1fr\)\)/);
    assert.match(selectorRule, /overflow:\s*hidden/);
    assert.match(selectorRule, /scrollbar-width:\s*none/);
    assert.match(css, /\.date-selector::-webkit-scrollbar\s*\{\s*display:\s*none/);
    assert.match(app, /dateButtons\.style\.overflow = 'hidden'/);
    assert.match(app, /dateButtons\.style\.scrollbarWidth = 'none'/);
    assert.match(legacyButtonsRule, /overflow:\s*visible/);
    assert.doesNotMatch(legacyButtonsRule, /overflow-x:\s*auto|scrollbar-width/);
});

test('原页面包含可编辑、可拖动并持久化的悬浮便签', () => {
    const html = read('index.html');
    const app = read('app.js');
    const css = read('style.css');

    for (const id of ['floatingNote', 'floatingNoteHandle', 'floatingNoteText', 'floatingNoteToggle', 'floatingNoteStatus']) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.doesNotMatch(html, /floatingNoteFontSize|floatingNoteColor/);
    assert.match(html, /style\.css\?v=20260729-0930/);
    assert.match(html, /app\.js\?v=20260729-0930/);
    assert.match(app, /const FLOATING_NOTE_STORAGE_KEY = 'floatingNoteV1'/);
    assert.match(app, /function initFloatingNote\(\)/);
    assert.match(app, /localStorage\.getItem\(FLOATING_NOTE_STORAGE_KEY\)/);
    assert.match(app, /localStorage\.setItem\(FLOATING_NOTE_STORAGE_KEY/);
    assert.match(app, /handle\.addEventListener\('pointerdown'/);
    assert.match(app, /handle\.addEventListener\('pointermove'/);
    assert.match(app, /handle\.addEventListener\('pointerup'/);
    assert.match(app, /textarea\.addEventListener\('input'/);
    assert.doesNotMatch(app, /fontSize|color\.value/);
    assert.match(app, /initFloatingNote\(\);/);
    assert.match(css, /\.floating-note\s*\{[\s\S]*?position:\s*fixed/);
    assert.match(css, /color:\s*#c62828/);
    assert.match(css, /font:\s*700 14px\/1\.55/);
    assert.match(css, /\.floating-note\.collapsed/);
    assert.match(css, /touch-action:\s*none/);
});

test('便签自动识别M月D日格式并替换为当天日期', () => {
    const app = read('app.js');
    assert.match(app, /NOTE_DATE_PATTERN = \/\\d\{1,2\}月\\d\{1,2\}日\/g/);
    assert.match(app, /function formatTodayNoteDate/);
    assert.match(app, /\.replace\(NOTE_DATE_PATTERN, todayDateStr\)/);
    assert.match(app, /syncNoteToServer\(textarea\.value\)/);
    assert.doesNotMatch(app, /\{\{date\}\}/);
});

test('今日推荐关联关注板块开关可切换并刷新推荐结果', () => {
    const html = read('index.html');
    const app = read('app.js');
    const config = read('config.js');
    const leaders = read('leaders.js');
    assert.match(html, /id=["']toggleCondFocusRequired["']/);
    assert.match(config, /let LEADER_COND_FOCUS_REQUIRED = true; \/\/ 今日推荐条件：至少一个所属板块进入关注板块/);
    assert.match(leaders, /if \(LEADER_COND_FOCUS_REQUIRED\)/);
    assert.match(leaders, /focusRequired === LEADER_COND_FOCUS_REQUIRED/);
    assert.match(leaders, /focusRequired: LEADER_COND_FOCUS_REQUIRED/);
    assert.match(app, /toggleCondFocusRequired.*addEventListener\('change'/);
    assert.match(app, /LEADER_COND_FOCUS_REQUIRED = e\.target\.checked;/);
    assert.match(app, /_todayLeadersCache = null;/);
});

test('今日推荐收盘/开盘比开关可切换并刷新推荐结果', () => {
    const html = read('index.html');
    const app = read('app.js');
    const config = read('config.js');
    const leaders = read('leaders.js');
    assert.match(html, /id=["']toggleCondCloseOpenRatio["']/);
    assert.match(config, /const CLOSE_OPEN_RATIO_MAX = 1\.03;/);
    assert.match(config, /let LEADER_COND_CLOSE_OPEN_RATIO = true; \/\/ 今日推荐条件：收盘价\/开盘价/);
    assert.match(leaders, /leaderCondCloseOpenRatio/);
    assert.match(leaders, /closeOpenRatio === LEADER_COND_CLOSE_OPEN_RATIO/);
    assert.match(leaders, /closeOpenRatio: LEADER_COND_CLOSE_OPEN_RATIO/);
    assert.match(app, /toggleCondCloseOpenRatio.*addEventListener\('change'/);
    assert.match(app, /LEADER_COND_CLOSE_OPEN_RATIO = e\.target\.checked;/);
});

test('今日推荐5日均价>=10日均价开关可切换并刷新推荐结果', () => {
    const html = read('index.html');
    const app = read('app.js');
    const config = read('config.js');
    const leaders = read('leaders.js');
    assert.match(html, /id=["']toggleCondAvg5GeAvg10["']/);
    assert.match(config, /let LEADER_COND_AVG5_GE_AVG10 = true;/);
    assert.match(leaders, /leaderCondAvg5GeAvg10/);
    assert.match(leaders, /avg5GeAvg10 === LEADER_COND_AVG5_GE_AVG10/);
    assert.match(leaders, /avg5GeAvg10: LEADER_COND_AVG5_GE_AVG10/);
    assert.match(app, /toggleCondAvg5GeAvg10.*addEventListener\('change'/);
    assert.match(app, /LEADER_COND_AVG5_GE_AVG10 = e\.target\.checked;/);
});

test('list.json 全部指向可读取且结构有效的 schema v3 数据', () => {
    const manifest = JSON.parse(read('list.json'));
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
    for (const entry of manifest.files) {
        assert.equal(entry.schemaVersion, 3);
        const data = JSON.parse(read(entry.path));
        assert.equal(data.schemaVersion, 3);
        assert.equal(data.交易日期, entry.tradingDate);
        assert.ok(data.股票字典 && typeof data.股票字典 === 'object');
        for (const group of ['行业板块资金流向', '概念板块资金流向']) {
            assert.ok(Array.isArray(data[group]));
            for (const sector of data[group]) {
                assert.ok(Array.isArray(sector.股票键));
                assert.equal(Number(sector.股票数量), sector.股票键.length);
                for (const stockKey of sector.股票键) assert.ok(data.股票字典[stockKey], `${entry.path} 缺少 ${stockKey}`);
            }
        }
    }
});
