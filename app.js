// ===== 入口：Excel 上传与初始化 =====

/** 集中绑定所有事件监听（替代 HTML 内联 onclick/onchange） */
function initEventListeners() {
    // 控件按钮
    document.getElementById('btnParseExcel').addEventListener('click', parseExcelFile);
    document.getElementById('btnLoadData').addEventListener('click', loadAllJsonFiles);
    document.getElementById('btnRefresh').addEventListener('click', updateCharts);
    document.getElementById('excelFileInput').addEventListener('change', handleExcelFile);

    // 流入/流出单选
    document.querySelectorAll('input[name="flowFilter"]').forEach(el => {
        el.addEventListener('change', updateCharts);
    });

    // 数量输入框
    document.getElementById('industryCount').addEventListener('change', updateCharts);
    document.getElementById('conceptCount').addEventListener('change', updateCharts);

    // 查看全部弹窗
    document.getElementById('modalOverlay').addEventListener('click', function(e) {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('btnCloseModal').addEventListener('click', closeModal);
    document.getElementById('btnAllIndustry').addEventListener('click', function() {
        showAllData('行业板块资金流向');
    });
    document.getElementById('btnAllConcept').addEventListener('click', function() {
        showAllData('概念板块资金流向');
    });
    document.getElementById('filterInvalid').addEventListener('change', renderModalTable);

    // 弹窗表格排序（事件委托：thead 上监听，根据 data-sort 属性判断）
    document.querySelector('.modal-table thead').addEventListener('click', function(e) {
        const th = e.target.closest('th[data-sort]');
        if (th) sortModalTable(th.dataset.sort);
    });

    // 趋势对比弹窗
    document.getElementById('trendModalOverlay').addEventListener('click', function(e) {
        if (e.target === e.currentTarget) closeTrendModal();
    });
    document.getElementById('btnCloseTrendModal').addEventListener('click', closeTrendModal);
    document.getElementById('trendChartTabBtn').addEventListener('click', function() {
        switchTrendChartTab('chart');
    });
    document.getElementById('trendStockTabBtn').addEventListener('click', function() {
        switchTrendChartTab('stock');
    });

    // 日期按钮事件委托（含展开/收起）
    document.getElementById('dateButtons').addEventListener('click', function(e) {
        const btn = e.target.closest('.date-btn');
        if (!btn) return;

        // 展开/收起按钮
        const action = btn.dataset.action;
        if (action === 'expand-dates') {
            expandAllDates();
            return;
        }
        if (action === 'collapse-dates') {
            // 收起：重新渲染仅显示最近 TREND_CHART_DAYS 个按钮
            // 先恢复当前选中状态
            const current = currentDateFile;
            renderDateButtons();
            if (current) {
                const btns = document.querySelectorAll('.date-btn');
                btns.forEach(b => {
                    if (b.dataset.datefile === current) b.classList.add('active');
                });
            }
            return;
        }

        // 日期切换按钮
        const filename = btn.dataset.datefile;
        if (!filename) return;
        setCurrentDateFile(filename);
        document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateCharts();
    });

    // 龙头标签事件委托
    document.getElementById('leaderContent').addEventListener('click', function(e) {
        const item = e.target.closest('.leader-item.leader-clickable');
        if (!item) return;
        const stockName = item.dataset.stock;
        const sectorsJson = item.dataset.sectors;
        if (!stockName || !sectorsJson) return;
        try {
            const sectors = JSON.parse(sectorsJson);
            showStockLeader(stockName, sectors);
        } catch (err) {
            console.error('解析龙头标签数据失败:', err);
        }
    });

    // 关注板块标签事件委托
    document.getElementById('focusContent').addEventListener('click', function(e) {
        const pair = e.target.closest('.pair.clickable');
        if (!pair) return;
        const sectorName = pair.dataset.sector;
        const dataType = pair.dataset.type;
        const matchedJson = pair.dataset.matched;
        const stocksJson = pair.dataset.stocks;
        const commonJson = pair.dataset.common;
        if (!sectorName || !dataType) return;
        try {
            const matchedSectors = matchedJson ? JSON.parse(matchedJson) : [];
            const stocks = stocksJson ? JSON.parse(stocksJson) : [];
            const commonStockNames = commonJson ? new Set(JSON.parse(commonJson)) : new Set();
            const typeLabel = dataType === '行业板块资金流向' ? '🏛️' : '💡';
            showSingleTrendModal(sectorName, dataType, typeLabel + ' ' + sectorName, matchedSectors, stocks, commonStockNames);
        } catch (err) {
            console.error('解析关注板块标签数据失败:', err);
        }
    });

    // 股票面板表格行事件委托（趋势弹窗右侧）
    document.getElementById('stockPanelList').addEventListener('click', function(e) {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const stockName = tr.dataset.stockName;
        const stockCode = tr.dataset.stockCode;
        if (stockName) openStockQuote(stockName, stockCode || '');
    });

    // 趋势弹窗相关板块标签事件委托
    document.getElementById('trendMatchedSectors').addEventListener('click', function(e) {
        const tag = e.target.closest('.pair.clickable');
        if (!tag) return;
        const sectorName = tag.dataset.sector;
        const dataType = tag.dataset.type;
        const commonJson = tag.dataset.common;
        if (!sectorName || !dataType) return;
        e.stopPropagation();
        const commonStocks = commonJson ? new Set(JSON.parse(commonJson)) : new Set();
        switchTrendView(sectorName, dataType, commonStocks);
    });

    // 趋势弹窗标题点击：切换回到当前板块视图
    document.getElementById('trendModalTitle').addEventListener('click', function() {
        const sectorName = this.dataset.sector;
        const dataType = this.dataset.type;
        const commonJson = this.dataset.common;
        if (!sectorName || !dataType) return;
        const commonStocks = commonJson ? new Set(JSON.parse(commonJson)) : new Set();
        switchTrendView(sectorName, dataType, commonStocks);
    });
}

window.onload = function() {
    initEventListeners();
    loadAllJsonFiles();
};

// ==================== 解析数据 ====================

function parseExcelFile() {
    document.getElementById('excelFileInput').click();
}

async function handleExcelFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusDiv = document.getElementById('loadStatus');
    statusDiv.textContent = '⏳ 正在上传并解析Excel文件...';

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/parse', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || '服务器解析失败');
        }

        const result = await response.json();
        statusDiv.textContent = `✅ 解析完成：${result.industries} 个行业，${result.concepts} 个概念`;

        // 刷新数据
        await loadAllJsonFiles();

    } catch (err) {
        console.error('解析失败:', err);
        statusDiv.textContent = '❌ 解析失败: ' + err.message;
    } finally {
        event.target.value = '';
    }
}
