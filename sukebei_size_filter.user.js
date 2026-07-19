// ==UserScript==
// @name         Sukebei Chinese Title Size Filter
// @namespace    http://tampermonkey.net/
// @version      7.7
// @description  保留中文标题和大小过滤，并支持隐藏、显示或标识已访问项
// @author       qisexin
// @license      MIT
// @match        https://sukebei.nyaa.si/*
// @updateURL    https://github.com/qisexin/sukebei_filter/raw/main/sukebei_size_filter.user.js
// @downloadURL  https://github.com/qisexin/sukebei_filter/raw/main/sukebei_size_filter.user.js
// @supportURL   https://github.com/qisexin/sukebei_filter/issues
// @homepageURL  https://github.com/qisexin/sukebei_filter
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEYS = {
        SETTINGS: 'sukebeiSizeFilter.settings.v1',
        VISITED: 'sukebeiSizeFilter.visited.v1'
    };
    const VISITED_MAX_AGE_DAYS = 180;
    const VISITED_MAX_COUNT = 10000;
    const MARK_CLASS = 'sukebei-visited-filter-marked';
    const DETAIL_BADGE_ID = 'sukebei-visited-filter-detail-badge';
    const QUERY_RESULT_LIMIT = 20;
    const DISPLAY_MODES = {
        HIDE: 'hide',
        SHOW: 'show',
        MARK: 'mark'
    };
    const MODE_LABELS = {
        [DISPLAY_MODES.HIDE]: '隐藏',
        [DISPLAY_MODES.SHOW]: '显示',
        [DISPLAY_MODES.MARK]: '标识'
    };
    const MODE_COLORS = {
        [DISPLAY_MODES.HIDE]: '#FF9800',
        [DISPLAY_MODES.SHOW]: '#607D8B',
        [DISPLAY_MODES.MARK]: '#9C27B0'
    };
    const DEFAULT_SETTINGS = {
        minSizeMB: 400,
        displayMode: DISPLAY_MODES.HIDE,
        panelVisible: false,
        temporarilyShowAll: false
    };
    let settings = loadSettings();
    let panel;
    let triggerButton;
    let statusText;
    let minSizeInput;
    let showAllButton;
    let modeButton;
    let queryInput;
    let clearVisitedButton;
    let lastStats = null;
    let detailPreviousVisitTime = 0;

    function loadSettings() {
        try {
            const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}');
            return normalizeSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
        } catch (error) {
            console.warn('Failed to load filter settings:', error);
            return { ...DEFAULT_SETTINGS };
        }
    }

    function normalizeSettings(value) {
        const displayMode = Object.values(DISPLAY_MODES).includes(value.displayMode)
            ? value.displayMode
            : DISPLAY_MODES.HIDE;
        return { ...value, displayMode, temporarilyShowAll: false };
    }

    function saveSettings() {
        const { temporarilyShowAll, ...savedSettings } = settings;
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(savedSettings));
    }

    function loadVisitedMap() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.VISITED) || '{}');
        } catch (error) {
            console.warn('Failed to load visited items:', error);
            return {};
        }
    }

    function saveVisitedMap(visitedMap) {
        const cutoff = Date.now() - VISITED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
        const ids = Object.keys(visitedMap).filter(id => visitedMap[id] > cutoff);

        if (ids.length > VISITED_MAX_COUNT) {
            ids.sort((a, b) => visitedMap[b] - visitedMap[a]);
            ids.length = VISITED_MAX_COUNT;
        }

        const trimmed = {};
        ids.forEach(id => {
            trimmed[id] = visitedMap[id];
        });
        localStorage.setItem(STORAGE_KEYS.VISITED, JSON.stringify(trimmed));
    }

    function cleanupVisitedRecords() {
        saveVisitedMap(loadVisitedMap());
    }

    function getTorrentIdFromPath(pathname) {
        const match = String(pathname || '').match(/^\/view\/(\d+)/);
        return match ? match[1] : '';
    }

    function isDetailPage() {
        return Boolean(getTorrentIdFromPath(location.pathname));
    }

    function isListPage() {
        return !isDetailPage();
    }

    function getTorrentIdFromLink(link) {
        try {
            const url = new URL(link.getAttribute('href'), location.origin);
            return url.origin === location.origin ? getTorrentIdFromPath(url.pathname) : '';
        } catch (error) {
            return '';
        }
    }

    function isVisited(id, visitedMap) {
        return Boolean(id && visitedMap[id]);
    }

    function recordDetailPage() {
        const id = getTorrentIdFromPath(location.pathname);
        if (!id) return;

        const visitedMap = loadVisitedMap();
        detailPreviousVisitTime = Number(visitedMap[id]) || 0;
        visitedMap[id] = Date.now();
        saveVisitedMap(visitedMap);
    }

    function showDetailVisitedMark() {
        const existingBadge = document.getElementById(DETAIL_BADGE_ID);
        if (!isDetailPage() || !document.body) {
            if (existingBadge) existingBadge.remove();
            return;
        }

        const id = getTorrentIdFromPath(location.pathname);
        if (!detailPreviousVisitTime) {
            if (existingBadge) existingBadge.remove();
            return;
        }

        const badgeText = `已访问：${id}\n访问时间：${new Date(detailPreviousVisitTime).toLocaleString()}`;
        if (existingBadge) {
            existingBadge.textContent = badgeText;
            return;
        }

        const badge = document.createElement('div');
        badge.id = DETAIL_BADGE_ID;
        badge.textContent = badgeText;
        badge.style.position = 'fixed';
        badge.style.top = '10px';
        badge.style.right = '10px';
        badge.style.zIndex = '10000';
        badge.style.padding = '8px 12px';
        badge.style.backgroundColor = MODE_COLORS[DISPLAY_MODES.MARK];
        badge.style.color = 'white';
        badge.style.borderRadius = '4px';
        badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
        badge.style.fontWeight = 'bold';
        badge.style.whiteSpace = 'pre-line';
        document.body.appendChild(badge);
    }

    function clearVisitedRecords() {
        localStorage.removeItem(STORAGE_KEYS.VISITED);
    }

    function getTorrentIdFromQuery(value) {
        const text = String(value || '').trim();
        if (/^\d+$/.test(text)) return text;

        const pathMatch = text.match(/(?:^|\/)view\/(\d+)/);
        if (pathMatch) return pathMatch[1];

        try {
            const url = new URL(text, location.origin);
            return url.origin === location.origin ? getTorrentIdFromPath(url.pathname) : '';
        } catch (error) {
            return '';
        }
    }

    function findVisitedMatches(query, visitedMap) {
        return Object.keys(visitedMap)
            .filter(id => id.includes(query))
            .sort((a, b) => (Number(b === query) - Number(a === query)) || visitedMap[b] - visitedMap[a]);
    }

    function formatVisitedMatches(matches, visitedMap) {
        const lines = matches.slice(0, QUERY_RESULT_LIMIT).map(id => (
            `${id}：${new Date(visitedMap[id]).toLocaleString()}`
        ));
        const moreCount = matches.length - lines.length;
        if (moreCount > 0) lines.push(`另有 ${moreCount} 条未显示`);
        return lines.join('\n');
    }

    function queryVisitedRecord() {
        const query = getTorrentIdFromQuery(queryInput && queryInput.value);
        if (!query) {
            alert('请输入有效的 Sukebei ID 或详情页链接');
            return;
        }

        const visitedMap = loadVisitedMap();
        const matches = findVisitedMatches(query, visitedMap);
        if (!matches.length) {
            alert(`${query} 未匹配到已访问记录`);
            return;
        }

        alert([
            `${query} 匹配到 ${matches.length} 条已访问记录`,
            formatVisitedMatches(matches, visitedMap)
        ].join('\n'));
    }

    function convertSizeToMB(sizeText) {
        const match = String(sizeText || '').trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
        if (!match) return 0;

        const value = Number.parseFloat(match[1]);
        if (!Number.isFinite(value)) return 0;

        const unit = match[2].toUpperCase();
        const unitMultipliers = {
            B: 1 / 1024 / 1024,
            KB: 1 / 1024,
            KIB: 1 / 1024,
            MB: 1,
            MIB: 1,
            GB: 1024,
            GIB: 1024,
            TB: 1024 * 1024,
            TIB: 1024 * 1024
        };

        return value * (unitMultipliers[unit] || 0);
    }

    function hasChineseTitle(title) {
        return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(title || '');
    }

    function hasJapaneseKana(title) {
        return /[\u3040-\u30ff\uff66-\uff9f]/.test(title || '');
    }

    function hasCodePattern(title) {
        const text = String(title || '');
        return /\b[A-Za-z]{2,8}[-_ ]?\d{2,6}\b/.test(text);
    }

    function getTorrentInfo(row) {
        const cells = row.querySelectorAll('td');
        const nameCell = row.querySelector('td[colspan="2"]') || cells[1] || cells[0];
        const nameLink = nameCell ? nameCell.querySelector('a[href^="/view/"]') : null;
        const sizeCell = cells.length === 8 ? cells[3] : cells.length === 9 ? cells[4] : null;

        return {
            id: nameLink ? getTorrentIdFromLink(nameLink) : '',
            title: (nameLink || nameCell) ? (nameLink || nameCell).textContent.trim() : '',
            sizeMB: sizeCell ? convertSizeToMB(sizeCell.textContent) : 0
        };
    }

    function getHideReason(info) {
        if (hasJapaneseKana(info.title)) return '日文标题';
        if (!hasChineseTitle(info.title)) return '非中文标题';
        if (hasCodePattern(info.title)) return '疑似番号';
        if (info.sizeMB < settings.minSizeMB) return `小于 ${settings.minSizeMB}MB`;
        return '';
    }

    function filterRows() {
        if (!isListPage()) return;

        const rows = Array.from(document.querySelectorAll('table.torrent-list tbody tr'));
        const visitedMap = loadVisitedMap();
        const stats = {
            total: rows.length,
            visible: 0,
            hidden: 0,
            visited: 0,
            visitedHidden: 0,
            noChineseTitle: 0,
            japaneseTitle: 0,
            codeTitle: 0,
            tooSmall: 0
        };

        rows.forEach(row => {
            const info = getTorrentInfo(row);
            const reason = getHideReason(info);
            const visited = isVisited(info.id, visitedMap);
            const hiddenByBaseFilter = Boolean(reason) && !settings.temporarilyShowAll && !visited;
            const hiddenByVisited = visited && settings.displayMode === DISPLAY_MODES.HIDE && !settings.temporarilyShowAll;
            const shouldMark = visited && settings.displayMode === DISPLAY_MODES.MARK && !settings.temporarilyShowAll;
            const shouldHide = hiddenByBaseFilter || hiddenByVisited;

            row.dataset.filterReason = reason;
            row.dataset.sukebeiVisited = visited ? 'true' : 'false';
            row.style.display = shouldHide ? 'none' : '';
            row.classList.toggle(MARK_CLASS, shouldMark);

            if (visited) stats.visited++;
            if (hiddenByVisited) stats.visitedHidden++;

            if (shouldHide) {
                stats.hidden++;
            } else {
                stats.visible++;
            }

            if (!hiddenByBaseFilter) return;

            if (reason === '日文标题') {
                stats.japaneseTitle++;
            } else if (reason === '非中文标题') {
                stats.noChineseTitle++;
            } else if (reason === '疑似番号') {
                stats.codeTitle++;
            } else {
                stats.tooSmall++;
            }
        });

        updateStatus(stats);
    }

    function updateStatus(stats) {
        lastStats = stats;
        if (!statusText) {
            updateTriggerButton(stats);
            return;
        }

        if (settings.temporarilyShowAll) {
            statusText.textContent = `已显示全部：共 ${stats.total} 条`;
            updateTriggerButton(stats);
            return;
        }

        statusText.textContent = [
            `显示 ${stats.visible}/${stats.total}，隐藏 ${stats.hidden}`,
            `已访问：${MODE_LABELS[settings.displayMode]}（${stats.visited}）`,
            `日文 ${stats.japaneseTitle} · 非中文 ${stats.noChineseTitle} · 番号 ${stats.codeTitle} · 过小 ${stats.tooSmall}`
        ].join('\n');
        updateTriggerButton(stats);
    }

    function getTriggerColor() {
        if (settings.temporarilyShowAll) return '#4CAF50';
        return MODE_COLORS[settings.displayMode] || '#607D8B';
    }

    function updateTriggerButton(stats = lastStats) {
        if (!triggerButton) return;

        const label = settings.temporarilyShowAll ? '全部' : '筛选';
        const countText = stats ? ` ${stats.visible}/${stats.total}` : '';
        triggerButton.textContent = `${label}${countText}`;
        triggerButton.style.backgroundColor = getTriggerColor();
        triggerButton.style.boxShadow = settings.panelVisible
            ? '0 0 0 2px rgba(255, 255, 255, 0.85), 0 2px 8px rgba(0, 0, 0, 0.25)'
            : '0 2px 8px rgba(0, 0, 0, 0.25)';
    }

    function createTriggerButton() {
        if (!isListPage() || !document.body) return;

        triggerButton = createButton('筛选', getTriggerColor());
        triggerButton.style.position = 'fixed';
        triggerButton.style.top = '10px';
        triggerButton.style.right = '10px';
        triggerButton.style.zIndex = '10000';
        triggerButton.style.fontWeight = 'bold';
        triggerButton.title = '点击展开/收起面板，Alt+F 面板，Alt+A 显示全部，Alt+V 已访问模式';
        triggerButton.addEventListener('click', togglePanel);
        document.body.appendChild(triggerButton);
        updateTriggerButton();
    }

    function closePanel() {
        if (!settings.panelVisible || !panel) return;

        settings.panelVisible = false;
        panel.style.display = 'none';
        saveSettings();
        updateTriggerButton();
    }

    function handleKeyboardShortcuts(event) {
        if (event.isComposing) return;

        const key = String(event.key || '').toLowerCase();
        const onlyAlt = event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey;

        if (onlyAlt && key === 'f') {
            event.preventDefault();
            togglePanel();
            return;
        }

        if (onlyAlt && key === 'a') {
            event.preventDefault();
            toggleShowAll();
            return;
        }

        if (onlyAlt && key === 'v') {
            event.preventDefault();
            cycleDisplayMode();
            return;
        }

        if (event.key === 'Escape') closePanel();
    }

    function applyMinSize() {
        const nextMinSize = Number.parseInt(minSizeInput.value, 10);
        if (!Number.isFinite(nextMinSize) || nextMinSize < 0) {
            minSizeInput.value = settings.minSizeMB;
            return;
        }

        settings.minSizeMB = nextMinSize;
        settings.temporarilyShowAll = false;
        saveSettings();
        updateShowAllButton();
        filterRows();
    }

    function togglePanel() {
        if (!panel) return;
        settings.panelVisible = !settings.panelVisible;
        panel.style.display = settings.panelVisible ? 'block' : 'none';
        saveSettings();
        updateTriggerButton();
    }

    function toggleShowAll() {
        settings.temporarilyShowAll = !settings.temporarilyShowAll;
        updateShowAllButton();
        filterRows();
    }

    function updateShowAllButton() {
        if (!showAllButton) return;
        showAllButton.textContent = settings.temporarilyShowAll ? '恢复过滤' : '显示全部';
        showAllButton.style.backgroundColor = settings.temporarilyShowAll ? '#4CAF50' : '#f44336';
        showAllButton.title = 'Alt+A 临时显示全部 / 恢复过滤';
    }

    function updateModeButton() {
        if (!modeButton) return;
        modeButton.textContent = `已访问：${MODE_LABELS[settings.displayMode]}`;
        modeButton.style.backgroundColor = MODE_COLORS[settings.displayMode];
        modeButton.title = 'Alt+V 切换：隐藏 / 显示 / 标识已访问';
    }

    function cycleDisplayMode() {
        const modes = [DISPLAY_MODES.HIDE, DISPLAY_MODES.SHOW, DISPLAY_MODES.MARK];
        const currentIndex = modes.indexOf(settings.displayMode);
        settings.displayMode = modes[(currentIndex + 1) % modes.length];
        saveSettings();
        updateModeButton();
        filterRows();
        showDetailVisitedMark();
    }

    function clearAllVisitedRecords() {
        if (!confirm('确定要清空所有 Sukebei 已访问记录吗？此操作不可撤销。')) return;
        clearVisitedRecords();
        filterRows();
    }

    function ensureMarkStyle() {
        if (document.getElementById('sukebei-visited-filter-style')) return;

        const style = document.createElement('style');
        style.id = 'sukebei-visited-filter-style';
        style.textContent = `
            .${MARK_CLASS} {
                box-shadow: inset 0 0 0 2px #FF9800 !important;
            }

            .${MARK_CLASS} > td {
                background-color: rgba(255, 152, 0, 0.18) !important;
            }
        `;
        document.head.appendChild(style);
    }

    function createButton(text, backgroundColor) {
        const button = document.createElement('button');
        button.textContent = text;
        button.style.padding = '5px 10px';
        button.style.backgroundColor = backgroundColor;
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '3px';
        button.style.cursor = 'pointer';
        button.style.marginRight = '5px';
        return button;
    }

    function createQueryInput(placeholder) {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.style.width = '170px';
        input.style.color = 'black';
        input.style.marginRight = '5px';
        return input;
    }

    function createPanel() {
        if (!isListPage() || !document.body) return;

        panel = document.createElement('div');
        panel.style.position = 'fixed';
        panel.style.top = '48px';
        panel.style.right = '10px';
        panel.style.zIndex = '9999';
        panel.style.backgroundColor = 'rgba(0, 0, 0, 0.82)';
        panel.style.color = 'white';
        panel.style.padding = '10px';
        panel.style.borderRadius = '5px';
        panel.style.fontSize = '14px';
        panel.style.minWidth = '320px';
        panel.style.display = settings.panelVisible ? 'block' : 'none';

        statusText = document.createElement('div');
        statusText.style.marginBottom = '10px';
        statusText.style.whiteSpace = 'pre-line';

        const sizeLabel = document.createElement('label');
        sizeLabel.textContent = '最小大小 (MB): ';
        sizeLabel.style.marginRight = '5px';

        minSizeInput = document.createElement('input');
        minSizeInput.type = 'number';
        minSizeInput.min = '0';
        minSizeInput.step = '50';
        minSizeInput.value = settings.minSizeMB;
        minSizeInput.style.width = '80px';
        minSizeInput.style.color = 'black';
        minSizeInput.style.marginRight = '5px';
        minSizeInput.title = '输入后按 Enter 或点击应用';

        const applyButton = createButton('应用', '#2196F3');
        showAllButton = createButton('', '#f44336');
        modeButton = createButton('', '#FF9800');
        queryInput = createQueryInput('ID 或详情页链接');
        const queryButton = createButton('查询', '#2196F3');
        clearVisitedButton = createButton('清空记录', '#607D8B');
        applyButton.title = '应用最小大小，输入框内可按 Enter';
        clearVisitedButton.title = '危险操作：清空全部已访问记录';
        clearVisitedButton.style.fontSize = '12px';
        clearVisitedButton.style.opacity = '0.8';

        applyButton.addEventListener('click', applyMinSize);
        minSizeInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') applyMinSize();
        });
        showAllButton.addEventListener('click', toggleShowAll);
        modeButton.addEventListener('click', cycleDisplayMode);
        queryButton.addEventListener('click', queryVisitedRecord);
        queryInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') queryVisitedRecord();
        });
        clearVisitedButton.addEventListener('click', clearAllVisitedRecords);

        panel.appendChild(statusText);
        panel.appendChild(sizeLabel);
        panel.appendChild(minSizeInput);
        panel.appendChild(applyButton);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(document.createElement('br'));
        panel.appendChild(showAllButton);
        panel.appendChild(modeButton);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(document.createElement('br'));
        panel.appendChild(queryInput);
        panel.appendChild(queryButton);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(document.createElement('br'));
        panel.appendChild(clearVisitedButton);

        document.body.appendChild(panel);
        ensureMarkStyle();
        updateShowAllButton();
        updateModeButton();
    }

    function watchTableChanges() {
        if (!isListPage() || !document.body) return;

        const torrentTable = document.querySelector('table.torrent-list');
        if (!torrentTable) return;

        let filterTimer = null;
        const observer = new MutationObserver(mutations => {
            const hasNewRows = mutations.some(mutation => (
                mutation.type === 'childList' &&
                Array.from(mutation.addedNodes).some(node => (
                    node.nodeType === Node.ELEMENT_NODE &&
                    (node.tagName === 'TR' || node.querySelector('tr'))
                ))
            ));

            if (!hasNewRows) return;

            clearTimeout(filterTimer);
            filterTimer = setTimeout(filterRows, 100);
        });

        observer.observe(torrentTable, {
            childList: true,
            subtree: true
        });
    }

    cleanupVisitedRecords();
    recordDetailPage();
    showDetailVisitedMark();
    createTriggerButton();
    createPanel();
    filterRows();
    watchTableChanges();
    document.addEventListener('keydown', handleKeyboardShortcuts);
})();
