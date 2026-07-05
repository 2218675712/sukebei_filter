// ==UserScript==
// @name         Sukebei Chinese Title Size Filter
// @namespace    http://tampermonkey.net/
// @version      7.3
// @description  保留中文标题和大小过滤，并支持隐藏、显示或标识已访问项
// @author       qisexin
// @license      MIT
// @match        https://sukebei.nyaa.si/*
// @grant        GM_registerMenuCommand
// @updateURL    https://github.com/qisexin/sukebei_filter/raw/main/sukebei_size_filter.user.js
// @downloadURL  https://github.com/qisexin/sukebei_filter/raw/main/sukebei_size_filter.user.js
// @supportURL   https://github.com/qisexin/sukebei_filter/issues
// @homepageURL  https://github.com/qisexin/sukebei_filter
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'sukebeiChineseTitleFilterSettings';
    const VISITED_KEY = 'sukebeiVisitedItems';
    const VISITED_MAX_AGE_DAYS = 180;
    const VISITED_MAX_COUNT = 10000;
    const MARK_CLASS = 'sukebei-visited-filter-marked';
    const DISPLAY_MODES = {
        HIDE: 'hide',
        SHOW: 'show',
        MARK: 'mark'
    };
    const MODE_LABELS = {
        [DISPLAY_MODES.HIDE]: '隐藏已访问',
        [DISPLAY_MODES.SHOW]: '显示已访问',
        [DISPLAY_MODES.MARK]: '标识已访问'
    };
    const MODE_COLORS = {
        [DISPLAY_MODES.HIDE]: '#FF9800',
        [DISPLAY_MODES.SHOW]: '#9C27B0',
        [DISPLAY_MODES.MARK]: '#FF9800'
    };
    const DEFAULT_SETTINGS = {
        minSizeMB: 400,
        displayMode: DISPLAY_MODES.HIDE,
        panelVisible: false,
        temporarilyShowAll: false
    };
    let settings = loadSettings();
    let panel;
    let statusText;
    let minSizeInput;
    let showAllButton;
    let modeButton;
    let clearVisitedButton;

    function loadSettings() {
        try {
            const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSettings));
    }

    function loadVisitedMap() {
        try {
            return JSON.parse(localStorage.getItem(VISITED_KEY) || '{}');
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
        localStorage.setItem(VISITED_KEY, JSON.stringify(trimmed));
    }

    function cleanupVisitedRecords() {
        saveVisitedMap(loadVisitedMap());
    }

    function getTorrentIdFromPath(pathname) {
        const match = String(pathname || '').match(/^\/view\/(\d+)/);
        return match ? match[1] : '';
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
        visitedMap[id] = Date.now();
        saveVisitedMap(visitedMap);
    }

    function clearVisitedRecords() {
        localStorage.removeItem(VISITED_KEY);
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
        if (!statusText) return;

        if (settings.temporarilyShowAll) {
            statusText.textContent = `已临时显示全部：共 ${stats.total} 条`;
            return;
        }

        statusText.textContent = [
            `已访问模式：${MODE_LABELS[settings.displayMode]}`,
            `显示 ${stats.visible}/${stats.total}`,
            `隐藏 ${stats.hidden}`,
            `已访问 ${stats.visited}`,
            `已访问隐藏 ${stats.visitedHidden}`,
            `日文 ${stats.japaneseTitle}`,
            `非中文 ${stats.noChineseTitle}`,
            `番号 ${stats.codeTitle}`,
            `过小 ${stats.tooSmall}`
        ].join(' | ');
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
        settings.panelVisible = !settings.panelVisible;
        panel.style.display = settings.panelVisible ? 'block' : 'none';
        saveSettings();
    }

    function toggleShowAll() {
        settings.temporarilyShowAll = !settings.temporarilyShowAll;
        updateShowAllButton();
        filterRows();
    }

    function updateShowAllButton() {
        if (!showAllButton) return;
        showAllButton.textContent = settings.temporarilyShowAll ? '恢复过滤' : '临时显示全部';
        showAllButton.style.backgroundColor = settings.temporarilyShowAll ? '#4CAF50' : '#f44336';
    }

    function updateModeButton() {
        if (!modeButton) return;
        modeButton.textContent = `已访问：${MODE_LABELS[settings.displayMode]}`;
        modeButton.style.backgroundColor = MODE_COLORS[settings.displayMode];
    }

    function cycleDisplayMode() {
        const modes = [DISPLAY_MODES.HIDE, DISPLAY_MODES.SHOW, DISPLAY_MODES.MARK];
        const currentIndex = modes.indexOf(settings.displayMode);
        settings.displayMode = modes[(currentIndex + 1) % modes.length];
        saveSettings();
        updateModeButton();
        filterRows();
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

    function createPanel() {
        panel = document.createElement('div');
        panel.style.position = 'fixed';
        panel.style.top = '10px';
        panel.style.right = '10px';
        panel.style.zIndex = '9999';
        panel.style.backgroundColor = 'rgba(0, 0, 0, 0.82)';
        panel.style.color = 'white';
        panel.style.padding = '10px';
        panel.style.borderRadius = '5px';
        panel.style.fontSize = '14px';
        panel.style.display = settings.panelVisible ? 'block' : 'none';

        statusText = document.createElement('div');
        statusText.style.marginBottom = '10px';

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

        const applyButton = createButton('应用', '#2196F3');
        showAllButton = createButton('', '#f44336');
        modeButton = createButton('', '#FF9800');
        clearVisitedButton = createButton('清空已访问', '#607D8B');

        applyButton.addEventListener('click', applyMinSize);
        minSizeInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') applyMinSize();
        });
        showAllButton.addEventListener('click', toggleShowAll);
        modeButton.addEventListener('click', cycleDisplayMode);
        clearVisitedButton.addEventListener('click', clearAllVisitedRecords);

        panel.appendChild(statusText);
        panel.appendChild(sizeLabel);
        panel.appendChild(minSizeInput);
        panel.appendChild(applyButton);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(document.createElement('br'));
        panel.appendChild(showAllButton);
        panel.appendChild(modeButton);
        panel.appendChild(clearVisitedButton);

        document.body.appendChild(panel);
        ensureMarkStyle();
        updateShowAllButton();
        updateModeButton();
    }

    function watchTableChanges() {
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
    createPanel();
    filterRows();
    watchTableChanges();

    GM_registerMenuCommand('切换中文标题过滤面板', togglePanel);
    GM_registerMenuCommand('切换 Sukebei 已访问显示模式', cycleDisplayMode);
    GM_registerMenuCommand('清空 Sukebei 已访问记录', clearAllVisitedRecords);
})();
