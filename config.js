// ===== 全局常量、状态与缓存（必须在其他脚本之前加载） =====

// 阈值常量（集中管理，避免散落不一致）
const FOCUS_MIN_DAYS = 1;          // 关注板块 / 今日推荐条件②：板块连续流入最低天数
const HIGHLIGHT_MIN_DAYS = 3;      // 板块标签红色高亮阈值
const MODAL_DAYS_HIGHLIGHT = 3;    // 「查看全部」弹窗连续天数红色高亮阈值
const LEADER_STOCK_MIN_DAYS = 1;   // 今日推荐：股票连续流入最低天数
const LEADER_GAP = 1;              // 今日推荐：股票天数 vs 所属板块最大天数 容差
const VOLUME_WINDOW = 5;           // 成交量比较窗口（含当日，从选中日期往前）
const RATIO_TURNOVER_LOW = 0.9;   // 成交额缩量阈值（当日 > 前一日 × 此值）
const RATIO_TURNOVER_HIGH = 1.5;  // 成交额放量阈值（当日 < 前一日 × 此值）
const CHANGE_LIMIT_PCT = 5;       // 放量时涨跌幅限制（%）
const TREND_CHART_DAYS = 10;      // 趋势图显示天数

// 数据状态
let allDataByDate = {};
let dateFileList = [];
let currentDateFile = null;
let _sortedDateFileList = null;

// 计算缓存（随数据/选中日期变化而失效）
let _consecutiveInflowCache = null;  // Map<"板块|type", days>
let _stockDaysCache = null;          // Map<stockName, days>
let _stockFieldIndex = null;         // { [stockName]: { [dateFile]: { volume, net, amount, change, code } } }

/**
 * 清空所有缓存（数据完全重置时调用）。
 * 集中管理，避免新增缓存变量时遗漏失效点。
 */
function invalidateAllCaches() {
    _sortedDateFileList = null;
    _consecutiveInflowCache = null;
    _stockDaysCache = null;
    _stockFieldIndex = null;
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
    if (typeof _stockSectorsMap !== 'undefined') _stockSectorsMap = null;
}

// 图表实例
let industryChart = null;
let conceptChart = null;
let trendNetChart = null;
let trendTurnoverChart = null;

// Chart.js 交替行背景插件
Chart.register({
    id: 'alternatingRows',
    beforeDraw: function(chart) {
        const ctx = chart.ctx;
        const chartArea = chart.chartArea;
        const yScale = chart.scales.y;
        if (!yScale || !yScale.ticks || yScale.ticks.length < 2) return;

        ctx.save();

        const ticks = yScale.ticks;
        for (let i = 0; i < ticks.length; i++) {
            if (i % 2 === 0) continue;

            const topY = i === 0
                ? chartArea.top
                : (ticks[i - 1].y + ticks[i].y) / 2;
            const bottomY = i === ticks.length - 1
                ? chartArea.bottom
                : (ticks[i].y + ticks[i + 1].y) / 2;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.fillRect(chartArea.left, topY, chartArea.right - chartArea.left, bottomY - topY);
        }

        ctx.restore();
    }
});
