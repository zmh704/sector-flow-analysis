// ===== 入口：Excel 上传与初始化 =====

/** 集中绑定所有事件监听（替代 HTML 内联 onclick/onchange） */
function initEventListeners() {
    // 控件按钮
    document.getElementById('btnParseExcel').addEventListener('click', parseExcelFile);
    document.getElementById('excelFileInput').addEventListener('change', handleExcelFile);

    // 行业流入/流出单选（独立控制行业图表）
    document.querySelectorAll('input[name="flowFilterIndustry"]').forEach(el => {
        el.addEventListener('change', debounce(updateCharts, 100));
    });
    // 概念流入/流出单选（独立控制概念图表）

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

    // 弹窗搜索过滤（200ms 防抖）
    document.getElementById('modalSearchInput').addEventListener('input', debounce(renderModalTable, 200));

    // 弹窗表格排序（事件委托：thead 上监听，根据 data-sort 属性判断）
    document.querySelector('.modal-table thead').addEventListener('click', function(e) {
        const th = e.target.closest('th[data-sort]');
        if (th) sortModalTable(th.dataset.sort);
    });

    // 查看全部弹窗表格行点击：打开板块详情弹窗（与关注板块标签一致）
    document.getElementById('modalBody').addEventListener('click', function(e) {
        const tr = e.target.closest('tr');
        if (!tr || !tr.dataset.sectorName) return; // 非数据行

        const sectorName = tr.dataset.sectorName;
        const type = modalDataType; // 全局变量：'行业板块资金流向' 或 '概念板块资金流向'
        const item = modalDataCache.find(d => d.板块 === sectorName);
        if (!item) return;

        const matchedSectors = item._matched || [];
        const stocks = item._parsedStocks || parseStocks(item.涉及股票);
        const commonStocks = new Set(matchedSectors.flatMap(m => m.commonStocks));
        const title = tr.dataset.title || `${escapeHtml(sectorName)} (${typeof item._days === 'number' ? item._days : '?'})天`;

        showSingleTrendModal(sectorName, type, title, matchedSectors, stocks, commonStocks);
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

    // 数据源切换：用当前股票重新加载图表 + 控制周期选择器显隐
    var sinaChartPeriodEl = document.getElementById('sinaChartPeriod');
    function updatePeriodVisibility() {
        sinaChartPeriodEl.style.display = document.getElementById('stockChartSource').value === 'sina_chart' ? '' : 'none';
    }
    document.getElementById('stockChartSource').addEventListener('change', function() {
        updatePeriodVisibility();
        if (_currentStockName && _currentStockCode) {
            loadTrendStock(_currentStockName, _currentStockCode);
        }
    });

    // 新浪图表周期切换：重新加载当前股票
    sinaChartPeriodEl.addEventListener('change', function() {
        if (_currentStockName && _currentStockCode) {
            loadTrendStock(_currentStockName, _currentStockCode);
        }
    });

    // 日期按钮事件委托
    document.getElementById('dateButtons').addEventListener('click', function(e) {
        const btn = e.target.closest('.date-btn');
        if (!btn) return;
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

    // 股票面板表格行事件委托（趋势弹窗右侧，涉及股票 / 今日推荐 两个页签共用）
    function handleStockPanelClick(e) {
        // 预选按钮点击
        const preselectBtn = e.target.closest('.stock-preselect-btn');
        if (preselectBtn) {
            e.stopPropagation();
            const stockName = preselectBtn.dataset.preselectStock;
            if (!stockName) return;
            const isNowPreselected = togglePreselectStock(stockName);
            // 同步更新弹窗内两个页签中同一股票的预选按钮
            document.querySelectorAll('.stock-preselect-btn').forEach(btn => {
                if (btn.dataset.preselectStock === stockName) {
                    btn.textContent = isNowPreselected ? '取消' : '预选';
                    btn.classList.toggle('preselected', isNowPreselected);
                }
            });
            // 同步更新首页今日推荐颜色
            const leaderItems = document.querySelectorAll('#leaderContent .leader-item');
            leaderItems.forEach(item => {
                if (item.dataset.stock === stockName) {
                    item.classList.toggle('leader-preselected', isNowPreselected);
                }
            });
            return;
        }
        const tr = e.target.closest('tr');
        if (!tr) return;
        const stockName = tr.dataset.stockName;
        const stockCode = tr.dataset.stockCode;
        if (!stockName) return;
        // 今日推荐页签：板块详情、窗口标题、关联板块整体跟随该股票更新（同首页今日推荐点击）
        if (e.currentTarget.id === 'stockPanelLeaderList') {
            const sectors = buildStockSectorsMap().get(stockName) || [];
            if (sectors.length > 0) {
                const leaderList = e.currentTarget;
                const scrollTop = leaderList.scrollTop;
                showStockLeader(stockName, sectors);
                // 保持停留在今日推荐页签并恢复滚动位置
                switchStockPanelTab('leaders');
                leaderList.scrollTop = scrollTop;
                return;
            }
        }
        openStockQuote(stockName, stockCode || '');
    }
    document.getElementById('stockPanelList').addEventListener('click', handleStockPanelClick);
    document.getElementById('stockPanelLeaderList').addEventListener('click', handleStockPanelClick);

    // 股票面板页签切换（涉及股票 / 今日推荐）
    document.getElementById('stockPanelStocksTabBtn').addEventListener('click', function() {
        switchStockPanelTab('stocks');
    });
    document.getElementById('stockPanelLeaderTabBtn').addEventListener('click', function() {
        switchStockPanelTab('leaders');
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
    // 初始化数据源下拉框默认值 + 周期选择器显隐
    document.getElementById('stockChartSource').value = STOCK_CHART_SOURCE;
    document.getElementById('sinaChartPeriod').style.display = STOCK_CHART_SOURCE === 'sina_chart' ? '' : 'none';
    initEventListeners();
    initKeyboardShortcuts();
    loadAllJsonFiles();
};

// ==================== 键盘快捷键 ====================

function initKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // 不处理输入框中的快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Esc 关闭弹窗
        if (e.key === 'Escape') {
            const trendOverlay = document.getElementById('trendModalOverlay');
            if (trendOverlay && trendOverlay.classList.contains('active')) {
                closeTrendModal();
                return;
            }
            const modalOverlay = document.getElementById('modalOverlay');
            if (modalOverlay && modalOverlay.classList.contains('active')) {
                closeModal();
                return;
            }
        }

        // ← → 切换日期
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const sorted = sortDateFileList();
            if (sorted.length === 0) return;
            const idx = sorted.indexOf(currentDateFile);
            if (idx < 0) return;
            const newIdx = e.key === 'ArrowRight'
                ? Math.min(idx + 1, sorted.length - 1)
                : Math.max(idx - 1, 0);
            if (newIdx === idx) return;
            const filename = sorted[newIdx];
            setCurrentDateFile(filename);
            // 更新日期按钮高亮
            document.querySelectorAll('.date-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.datefile === filename);
            });
            // 滚动到该按钮
            const activeBtn = document.querySelector('.date-btn.active');
            if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            updateCharts();
            e.preventDefault();
        }

        // 1-9 快速选择日期
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) {
            const btns = document.querySelectorAll('.date-btn[data-datefile]');
            if (num <= btns.length) {
                btns[num - 1].click();
                e.preventDefault();
            }
        }
    });
}

// ==================== 解析数据 ====================

function parseExcelFile() {
    document.getElementById('excelFileInput').click();
}

async function handleExcelFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoadingStatus('正在上传并解析Excel文件...');

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
        showSuccessStatus(`解析完成：${result.industries} 个行业，${result.concepts} 个概念`);

        // 刷新数据
        await loadAllJsonFiles();

    } catch (err) {
        console.error('解析失败:', err);
        showWarningStatus('解析失败: ' + err.message);
    } finally {
        event.target.value = '';
    }
}
