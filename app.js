// ===== 入口：Excel 上传与初始化 =====

const FLOATING_NOTE_STORAGE_KEY = 'floatingNoteV1';

/** 将悬浮便签限制在当前视口内，避免拖动或缩放窗口后丢失 */
function clampFloatingNotePosition(note, left, top) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - note.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - note.offsetHeight - margin);
    return {
        left: Math.min(Math.max(margin, left), maxLeft),
        top: Math.min(Math.max(margin, top), maxTop)
    };
}

/** 初始化可编辑、可拖动并自动保存的悬浮便签 */
function initFloatingNote() {
    const note = document.getElementById('floatingNote');
    const handle = document.getElementById('floatingNoteHandle');
    const textarea = document.getElementById('floatingNoteText');
    const toggle = document.getElementById('floatingNoteToggle');
    const status = document.getElementById('floatingNoteStatus');
    if (!note || !handle || !textarea || !toggle || !status) return;

    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(FLOATING_NOTE_STORAGE_KEY) || '{}');
    } catch (_error) {
        saved = {};
    }

    const hasLocalText = typeof saved.text === 'string';
    let noteEdited = false;
    textarea.value = hasLocalText ? saved.text : '';
    note.classList.toggle('collapsed', saved.collapsed === true);
    toggle.textContent = saved.collapsed === true ? '+' : '−';
    toggle.title = saved.collapsed === true ? '展开便签' : '折叠便签';
    toggle.setAttribute('aria-label', toggle.title);

    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        const position = clampFloatingNotePosition(note, saved.left, saved.top);
        note.style.left = position.left + 'px';
        note.style.top = position.top + 'px';
        note.style.right = 'auto';
        note.style.bottom = 'auto';
    }

    function readPosition() {
        const rect = note.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
    }

    let noteSaveQueue = Promise.resolve();

    function syncNoteToServer(text) {
        noteSaveQueue = noteSaveQueue
            .catch(() => {})
            .then(() => fetch('/api/note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            }).then(response => {
                if (!response.ok) throw new Error(`便签同步失败: HTTP ${response.status}`);
            }));
        return noteSaveQueue;
    }

    function persistNote(message) {
        const position = readPosition();
        try {
            localStorage.setItem(FLOATING_NOTE_STORAGE_KEY, JSON.stringify({
                text: textarea.value,
                left: Math.round(position.left),
                top: Math.round(position.top),
                collapsed: note.classList.contains('collapsed')
            }));
            // 同步保存到项目 note.txt；串行队列确保旧请求不会覆盖新内容
            syncNoteToServer(textarea.value).catch(() => {});
            if (message) {
                status.textContent = message;
                window.setTimeout(() => {
                    if (status.textContent === message) status.textContent = '内容自动保存';
                }, 1200);
            }
        } catch (_error) {
            status.textContent = '当前浏览器无法保存';
        }
    }

    if (!hasLocalText) {
        fetch('/api/note')
            .then(response => response.ok ? response.json() : null)
            .then(payload => {
                if (!noteEdited && payload && typeof payload.text === 'string') {
                    textarea.value = payload.text;
                    localStorage.setItem(FLOATING_NOTE_STORAGE_KEY, JSON.stringify({
                        text: payload.text,
                        left: Math.round(readPosition().left),
                        top: Math.round(readPosition().top),
                        collapsed: note.classList.contains('collapsed')
                    }));
                }
            })
            .catch(() => {});
    }

    let saveTimer = null;
    textarea.addEventListener('input', function() {
        noteEdited = true;
        status.textContent = '正在保存...';
        if (saveTimer) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            persistNote('已保存');
        }, 250);
    });

    toggle.addEventListener('click', function(event) {
        event.stopPropagation();
        const collapsed = !note.classList.contains('collapsed');
        note.classList.toggle('collapsed', collapsed);
        toggle.textContent = collapsed ? '+' : '−';
        toggle.title = collapsed ? '展开便签' : '折叠便签';
        toggle.setAttribute('aria-label', toggle.title);
        const current = readPosition();
        const position = clampFloatingNotePosition(note, current.left, current.top);
        note.style.left = position.left + 'px';
        note.style.top = position.top + 'px';
        note.style.right = 'auto';
        note.style.bottom = 'auto';
        persistNote();
    });

    let dragState = null;
    handle.addEventListener('pointerdown', function(event) {
        if (event.button !== 0 || event.target.closest('button')) return;
        const rect = note.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
        };
        note.style.left = rect.left + 'px';
        note.style.top = rect.top + 'px';
        note.style.right = 'auto';
        note.style.bottom = 'auto';
        note.classList.add('dragging');
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    handle.addEventListener('pointermove', function(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const position = clampFloatingNotePosition(
            note,
            event.clientX - dragState.offsetX,
            event.clientY - dragState.offsetY
        );
        note.style.left = position.left + 'px';
        note.style.top = position.top + 'px';
    });

    function finishDrag(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        dragState = null;
        note.classList.remove('dragging');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        persistNote('位置已保存');
    }

    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);

    window.addEventListener('resize', debounce(function() {
        const current = readPosition();
        const position = clampFloatingNotePosition(note, current.left, current.top);
        note.style.left = position.left + 'px';
        note.style.top = position.top + 'px';
        note.style.right = 'auto';
        note.style.bottom = 'auto';
        persistNote();
    }, 100));
}

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
    document.querySelectorAll('input[name="flowFilterConcept"]').forEach(el => {
        el.addEventListener('change', debounce(updateCharts, 100));
    });

    // 查看全部弹窗
    document.getElementById('modalOverlay').addEventListener('click', function(e) {
        if (e.target === e.currentTarget) closeModal();
    });
    document.querySelector('#modalOverlay .modal-content').addEventListener('click', e => e.stopPropagation());
    document.getElementById('filterToggleTh').addEventListener('click', e => e.stopPropagation());
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
        const stocks = getSectorStocks(item);
        const commonStocks = new Set(matchedSectors.flatMap(m => m.commonStocks));
        const title = tr.dataset.title || `${escapeHtml(sectorName)} (${typeof item._days === 'number' ? item._days : '?'})天`;

        showSingleTrendModal(sectorName, type, title, matchedSectors, stocks, commonStocks);
    });

    // 趋势对比弹窗
    document.getElementById('trendModalOverlay').addEventListener('click', function(e) {
        if (e.target === e.currentTarget) closeTrendModal();
    });
    document.querySelector('#trendModalOverlay .trend-modal-content').addEventListener('click', e => e.stopPropagation());
    document.getElementById('btnCloseTrendModal').addEventListener('click', closeTrendModal);
    document.getElementById('trendChartTabBtn').addEventListener('click', function() {
        switchTrendChartTab('chart');
    });
    document.getElementById('trendStockTabBtn').addEventListener('click', function() {
        switchTrendChartTab('stock');
    });

    // 东方财富按钮：新窗口打开当前股票的完整行情页
    document.getElementById('eastmoneyJumpBtn').addEventListener('click', function() {
        if (_currentStockCode) {
            window.open(buildEastmoneyUrl(_currentStockCode), '_blank', 'noopener');
        }
    });

    // 数据源按钮切换：点击切换 active + 控制周期按钮组显隐 + 重新加载图表
    var sinaPeriodTabsEl = document.getElementById('sinaPeriodTabs');
    document.querySelectorAll('.source-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.source-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            sinaPeriodTabsEl.style.display = btn.dataset.source === 'sina_chart' ? '' : 'none';
            if (_currentStockName && _currentStockCode) {
                loadTrendStock(_currentStockName, _currentStockCode);
            }
        });
    });

    // 新浪图表周期按钮切换：切换 active + 重新加载当前股票
    sinaPeriodTabsEl.querySelectorAll('.period-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            sinaPeriodTabsEl.querySelectorAll('.period-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            if (_currentStockName && _currentStockCode) {
                loadTrendStock(_currentStockName, _currentStockCode);
            }
        });
    });

    // 日期按钮事件委托；内联兜底确保旧CSS缓存下也不会出现日期滚动条
    const dateButtons = document.getElementById('dateButtons');
    dateButtons.style.overflow = 'hidden';
    dateButtons.style.scrollbarWidth = 'none';
    dateButtons.addEventListener('click', async function(e) {
        const btn = e.target.closest('.date-btn');
        if (!btn || btn.disabled) return;
        const filename = btn.dataset.datefile;
        if (!filename) return;
        btn.disabled = true;
        try {
            await selectDateFile(filename);
        } finally {
            btn.disabled = false;
        }
    });

    // 关联关注板块条件开关
    document.getElementById('toggleCondFocusRequired').addEventListener('change', function(e) {
        LEADER_COND_FOCUS_REQUIRED = e.target.checked;
        _todayLeadersCache = null;
        updateCharts();
        const leaderPanel = document.getElementById('stockPanelLeaderContent');
        if (leaderPanel?.classList.contains('active')) renderLeaderPanel();
    });

    // 收盘/开盘比条件开关
    document.getElementById('toggleCondCloseOpenRatio').addEventListener('change', function(e) {
        LEADER_COND_CLOSE_OPEN_RATIO = e.target.checked;
        _todayLeadersCache = null;
        updateCharts();
        const leaderPanel = document.getElementById('stockPanelLeaderContent');
        if (leaderPanel?.classList.contains('active')) renderLeaderPanel();
    });

    // 最高价突破条件开关
    document.getElementById('toggleCondHighHigher').addEventListener('change', function(e) {
        LEADER_COND_HIGH_HIGHER = e.target.checked;
        _todayLeadersCache = null;
        updateCharts();
        const leaderPanel = document.getElementById('stockPanelLeaderContent');
        if (leaderPanel?.classList.contains('active')) renderLeaderPanel();
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
        openFocusSector(sectorName, dataType);
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
        const stockKey = tr.dataset.stockKey;
        const stockCode = tr.dataset.stockCode;
        if (!stockName) return;
        // 今日推荐页签：板块详情、窗口标题、关联板块整体跟随该股票更新（同首页今日推荐点击）
        if (e.currentTarget.id === 'stockPanelLeaderList') {
            const identity = stockKey || resolveStockKey(stockName);
            const sectors = buildStockSectorsMap().get(identity) || [];
            if (sectors.length > 0) {
                const leaderList = e.currentTarget;
                const scrollTop = leaderList.scrollTop;
                showStockLeader(stockName, sectors);
                // 记录选中股票（须在 showStockLeader 之后，避免被其内部重置覆盖）
                _selectedStockName = stockName;
                _selectedFocusKey = null;
                // 保持停留在今日推荐页签并恢复滚动位置
                switchStockPanelTab('leaders');
                leaderList.scrollTop = scrollTop;
                return;
            }
        }
        // 涉及股票页签不重绘，记录选中并即时高亮当前行
        _selectedStockName = stockName;
        _selectedFocusKey = null;
        highlightSelectedStockRow(e.currentTarget);
        openStockQuote(stockName, stockCode || '');
    }
    document.getElementById('stockPanelList').addEventListener('click', handleStockPanelClick);
    document.getElementById('stockPanelLeaderList').addEventListener('click', handleStockPanelClick);

    // 股票面板表头排序委托（涉及股票 / 今日推荐）
    function handleStockHeaderSort(e) {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        sortStockTable(e.currentTarget, th.dataset.sort);
    }
    document.getElementById('stockPanelList').addEventListener('click', handleStockHeaderSort);
    document.getElementById('stockPanelLeaderList').addEventListener('click', handleStockHeaderSort);

    // 股票面板页签切换（涉及股票 / 今日推荐 / 关注板块）
    document.getElementById('stockPanelStocksTabBtn').addEventListener('click', function() {
        switchStockPanelTab('stocks');
    });
    document.getElementById('stockPanelLeaderTabBtn').addEventListener('click', function() {
        switchStockPanelTab('leaders');
    });
    document.getElementById('stockPanelFocusTabBtn').addEventListener('click', function() {
        switchStockPanelTab('focus');
    });

    // 关注板块页签表格行点击：打开该板块趋势弹窗（同首页关注板块点击效果）
    document.getElementById('stockPanelFocusList').addEventListener('click', function(e) {
        // 表头点击：排序
        const th = e.target.closest('th[data-sort]');
        if (th) { sortFocusTable(th.dataset.sort); return; }

        const tr = e.target.closest('tr');
        if (!tr || !tr.dataset.sector) return;
        const sectorName = tr.dataset.sector;
        const dataType = tr.dataset.type;
        const focusList = e.currentTarget;
        const scrollTop = focusList.scrollTop;
        if (!openFocusSector(sectorName, dataType)) return;
        // 记录选中板块（须在 showSingleTrendModal 之后，避免被其内部重置覆盖）
        _selectedFocusKey = sectorName + '|' + dataType;
        _selectedStockName = null;
        // 保持停留在关注板块页签并恢复滚动位置（showSingleTrendModal 内部会切到涉及股票页签）
        switchStockPanelTab('focus');
        focusList.scrollTop = scrollTop;
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
    // 初始化数据源按钮 active 状态 + 周期按钮组显隐
    document.querySelectorAll('.source-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.source === STOCK_CHART_SOURCE);
    });
    document.getElementById('sinaPeriodTabs').style.display = STOCK_CHART_SOURCE === 'sina_chart' ? '' : 'none';
    initEventListeners();
    initKeyboardShortcuts();
    initFloatingNote();
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
            selectDateFile(filename).then(selected => {
                if (!selected) return;
                const activeBtn = document.querySelector('.date-btn.active');
                if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            });
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
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
        showWarningStatus('请选择 .xlsx 或 .xls 文件');
        event.target.value = '';
        return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
        showWarningStatus(`文件过大，最大允许 ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MiB`);
        event.target.value = '';
        return;
    }

    showLoadingStatus('正在上传并解析Excel文件...');

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/parse', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                const skipped = payload.diagnostics?.skippedRows;
                throw new Error(payload.error + (skipped ? `（跳过 ${skipped} 行）` : ''));
            }
            const errText = await response.text();
            throw new Error(errText || '服务器解析失败');
        }

        const result = await response.json();
        const diagnostics = result.diagnostics;
        const warning = diagnostics?.skippedRows > 0
            ? `，跳过 ${diagnostics.skippedRows} 行（详见服务端日志）`
            : '';
        const elapsed = Number.isFinite(result.performance?.totalMs)
            ? `，耗时 ${result.performance.totalMs.toFixed(0)}ms`
            : '';
        showSuccessStatus(`解析完成：${result.industries} 个行业，${result.concepts} 个概念${warning}${elapsed}`);

        // 刷新数据
        await loadAllJsonFiles();

    } catch (err) {
        console.error('解析失败:', err);
        showWarningStatus('解析失败: ' + err.message);
    } finally {
        event.target.value = '';
    }
}
