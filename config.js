// ===== 全局常量、状态与缓存（必须在其他脚本之前加载） =====

// 阈值常量（集中管理，避免散落不一致）
const FOCUS_MIN_DAYS = 1;          // 关注板块 / 今日推荐条件②：板块连续流入最低天数
const HIGHLIGHT_MIN_DAYS = 3;      // 板块标签红色高亮阈值
const MODAL_DAYS_HIGHLIGHT = 3;    // 「查看全部」弹窗连续天数红色高亮阈值
const LEADER_STOCK_MIN_DAYS = 1;   // 今日推荐：股票连续流入最低天数
const LEADER_GAP = 1;              // 今日推荐：股票天数 vs 所属板块最大天数 容差
const VOLUME_WINDOW = 5;           // 成交量比较窗口（含当日，从选中日期往前）
const RATIO_TURNOVER_LOW = 0.9;   // 防止缩量过快：当日成交额必须 > 前一日 × 此值
const RATIO_TURNOVER_HIGH = 1.6;  // 防止放量过快：当日成交额必须 < 前一日 × 此值
const CHANGE_LIMIT_PCT = 20;       // 放量时涨跌幅限制（%）
let LEADER_COND_HIGH_HIGHER = true; // 今日推荐条件：当日最高价 > 前一日最高价（设为false可关闭此条件）
let LEADER_COND_FOCUS_REQUIRED = true; // 今日推荐条件：至少一个所属板块进入关注板块（设为false可关闭此条件）
let LEADER_COND_CLOSE_OPEN_RATIO = true; // 今日推荐条件：收盘价/开盘价 < CLOSE_OPEN_RATIO_MAX（设为false可关闭此条件）
const TREND_CHART_DAYS = 10;      // 趋势图显示天数
const DATA_ANALYSIS_DAYS = 12;    // 当前日期计算窗口；保持与原先“最近12日”业务口径一致
const MAX_LOADED_DATES = 20;      // 已加载日期 LRU 上限，控制长期浏览的内存增长
const DATE_BUTTON_LIMIT = 10;      // 日期选择器默认只展示最近10个交易日
const STOCK_CHART_SOURCE = 'sina_chart'; // 个股图表默认数据源：'sina_chart'（新浪图片） | 'tradingview'（TV嵌入）
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // Excel 上传上限（20 MiB，与服务端默认值一致）
const CLOSE_OPEN_RATIO_MAX = 1.03; // 今日推荐条件：收盘价/开盘价上限（防尾盘拉高出货或大幅高开低走）
let LEADER_COND_AVG5_GE_AVG10 = true; // 今日推荐条件：5日均价 >= 10日均价（设为false可关闭此条件）
let LEADER_COND_CLOSE_ABOVE_AVG5 = true; // 今日推荐条件：收盘价 > 5日均价（设为false可关闭此条件）

// ===== 通用工具函数 =====

/** 防抖：延迟 delay ms 后执行 fn，连续调用重置计时器 */
function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn.apply(this, args); }, delay);
    };
}

/** rAF 防抖：将多次触发合并到下一帧执行（适用于 DOM 批量更新） */
function debounceRAF(fn) {
    let rafId = null;
    return function (...args) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => { rafId = null; fn.apply(this, args); });
    };
}

// ===== 加载状态管理 =====
let _statusTimer = null;
let _statusVersion = 0;

function beginStatusUpdate() {
    _statusVersion++;
    if (_statusTimer) clearTimeout(_statusTimer);
    _statusTimer = null;
    return _statusVersion;
}

/** 显示加载状态文本（含 spinner 动画） */
function showLoadingStatus(text) {
    beginStatusUpdate();
    const el = document.getElementById('loadStatus');
    if (!el) return;
    el.innerHTML = `<span class="spinner"></span><span>${escapeHtml(text)}</span>`;
}

/** 显示加载进度条 + 文本 */
function showLoadingProgress(text, loaded, total) {
    beginStatusUpdate();
    const el = document.getElementById('loadStatus');
    if (!el) return;
    const pct = total > 0 ? Math.min(100, Math.round(loaded / total * 100)) : 0;
    el.innerHTML = `<span class="spinner"></span><span>${escapeHtml(text)}</span> <span class="progress-bar-wrap"><span class="progress-bar-fill" style="width:${pct}%"></span></span>`;
}

/** 显示成功状态（绿色勾，定时自动清除） */
function showSuccessStatus(text, timeout) {
    const version = beginStatusUpdate();
    const el = document.getElementById('loadStatus');
    if (!el) return;
    el.innerHTML = '✅ ' + escapeHtml(text);
    if (timeout !== false) {
        _statusTimer = setTimeout(() => {
            if (el && version === _statusVersion) el.textContent = '';
            _statusTimer = null;
        }, timeout || 4000);
    }
}

/** 显示警告/错误状态 */
function showWarningStatus(text) {
    beginStatusUpdate();
    const el = document.getElementById('loadStatus');
    if (!el) return;
    el.innerHTML = '⚠️ ' + escapeHtml(text);
}

/** 图表加载状态切换 */
function setChartLoading(loading) {
    document.querySelectorAll('.chart-wrapper').forEach(el => {
        el.classList.toggle('loading', loading);
    });
}

/** 渲染空状态占位 */
function renderEmptyState(icon, text, hint) {
    return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-text">${escapeHtml(text)}</div>${hint ? '<div class="empty-hint">' + escapeHtml(hint) + '</div>' : ''}</div>`;
}

// 数据状态
let allDataByDate = {};
let dateFileList = [];
let currentDateFile = null;
let _sortedDateFileList = null;

// 计算缓存（随数据/选中日期变化而失效）
let _consecutiveInflowCache = null;  // Map<"板块|type", days>
let _stockDaysCache = null;          // Map<stockKey, days>
let _stockFieldIndex = null;         // { [stockKey]: { [dateFile]: { volume, net, amount(亿,数值), change, code, high, open, low, close, avg5, avg10 } } }
let _stockKeysByDate = {};            // { [dateFile]: stockKey[] }，用于增量覆盖单个日期时精准清理旧索引
let _stockNameKeyIndex = null;       // Map<股票名称, stockKey>，兼容旧名称型交互和 localStorage
let _sectorFilterCache = null;       // Map<"日期|类型", Array>，当前日期板块筛选结果
let _dailySectorMapCache = new Map(); // "日期|类型"→板块Map，趋势与筛选共享
let _focusDataCache = null;          // { dateFile, data, value }，关注板块派生 view model
let _todayLeadersCache = null;       // { dateFile, highHigher, focusRequired, closeOpenRatio, value }，今日推荐派生结果（含筛选开关状态）
let _loadGeneration = 0;             // 数据加载代次，最后一次请求胜出
let _loadAbortController = null;     // 取消上一轮数据 fetch
let _dataManifest = [];              // 全量清单；日期按钮可展示尚未下载的历史日期
let _manifestEntryByPath = new Map(); // path→manifest entry，供按需加载历史窗口
let _dateAccessOrder = new Map();      // 已加载日期访问顺序，供 LRU 回收

/**
 * 清空所有缓存（数据完全重置时调用）。
 * 集中管理，避免新增缓存变量时遗漏失效点。
 */
function invalidateAllCaches() {
    _sortedDateFileList = null;
    _consecutiveInflowCache = null;
    _stockDaysCache = null;
    _stockFieldIndex = null;
    _stockKeysByDate = {};
    _stockNameKeyIndex = null;
    _sectorFilterCache = null;
    _dailySectorMapCache = new Map();
    _focusDataCache = null;
    _todayLeadersCache = null;
    _dataManifest = [];
    _manifestEntryByPath = new Map();
    _dateAccessOrder = new Map();
    // _stockSectorsMap 在 calc.js 中声明，控制流确保调用时已加载
    if (typeof _stockSectorsMap !== 'undefined') _stockSectorsMap = null;
}

/**
 * 仅清空依赖当前选中日期的缓存（切换日期或新增数据文件时调用）。
 * 不重置 _sortedDateFileList（排序结果不变）和 _stockFieldIndex（全量索引）。
 */
function invalidateDateCaches() {
    _consecutiveInflowCache = null;
    _stockDaysCache = null;
    _sectorFilterCache = null;
    _dailySectorMapCache = new Map();
    _focusDataCache = null;
    _todayLeadersCache = null;
    if (typeof _stockSectorsMap !== 'undefined') _stockSectorsMap = null;
}

// ===== 预选股票管理 =====
const _preselectedStocks = new Set(
    (() => {
        try {
            const saved = localStorage.getItem('preselectedStocks');
            if (!saved) return [];
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
        } catch { return []; }
    })()
);

function getPreselectKey(stockIdentity) {
    return resolveStockKey(stockIdentity);
}

function savePreselectedStocks() {
    try {
        localStorage.setItem('preselectedStocks', JSON.stringify({ version: 2, items: [..._preselectedStocks] }));
    } catch { }
}

/** 切换股票的预选/取消状态，返回切换后的状态（true=预选） */
function togglePreselectStock(stockIdentity) {
    const key = getPreselectKey(stockIdentity);
    if (_preselectedStocks.has(key)) {
        _preselectedStocks.delete(key);
        savePreselectedStocks();
        return false;
    } else {
        _preselectedStocks.add(key);
        savePreselectedStocks();
        return true;
    }
}

/** 判断股票是否已被预选 */
function isStockPreselected(stockIdentity) {
    const key = getPreselectKey(stockIdentity);
    return _preselectedStocks.has(key) || _preselectedStocks.has(stockIdentity);
}

/** 获取所有预选股票 key 的数组 */
function getPreselectedStocks() {
    return [..._preselectedStocks];
}

// 图表实例
let industryChart = null;
let conceptChart = null;
let trendNetChart = null;
let trendTurnoverChart = null;

// Chart.js 交替行背景插件
Chart.register({
    id: 'alternatingRows',
    beforeDraw: function (chart) {
        const ctx = chart.ctx;
        const chartArea = chart.chartArea;
        const yScale = chart.scales.y;
        if (!yScale || !yScale.ticks || yScale.ticks.length < 2) return;

        ctx.save();

        const ticks = yScale.ticks;
        for (let i = 0; i < ticks.length; i++) {
            if (i % 2 === 0) continue;
            const previousY = ticks[i - 1]?.y;
            const currentY = ticks[i]?.y;
            const nextY = ticks[i + 1]?.y;
            if (!Number.isFinite(currentY)
                || (i > 0 && !Number.isFinite(previousY))
                || (i < ticks.length - 1 && !Number.isFinite(nextY))) continue;

            const topY = i === 0 ? chartArea.top : (previousY + currentY) / 2;
            const bottomY = i === ticks.length - 1 ? chartArea.bottom : (currentY + nextY) / 2;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
            ctx.fillRect(chartArea.left, topY, chartArea.right - chartArea.left, bottomY - topY);
        }

        ctx.restore();
    }
});
