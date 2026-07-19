// ==UserScript==
// @name         SupJAV Visited Item Filter
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Record visited SupJAV detail pages and hide or show visited items on list pages
// @author       qisexin
// @license      MIT
// @match        https://supjav.com/*
// @match        https://www.supjav.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://github.com/qisexin/sukebei_filter/raw/main/supjav_visited_filter.user.js
// @downloadURL  https://github.com/qisexin/sukebei_filter/raw/main/supjav_visited_filter.user.js
// @supportURL   https://github.com/qisexin/sukebei_filter/issues
// @homepageURL  https://github.com/qisexin/sukebei_filter
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'supjavVisitedFilterSettings';
    const VISITED_KEY = 'supjavVisitedItems';
    const VISITED_MAX_AGE_DAYS = 180;
    const VISITED_MAX_COUNT = 10000;
    const DETAIL_BADGE_ID = 'supjav-visited-filter-detail-badge';
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
        displayMode: DISPLAY_MODES.HIDE,
        panelVisible: false
    };

    let settings = loadSettings();
    let panel;
    let triggerButton;
    let statusText;
    let modeButton;
    let queryInput;
    let lastStats = null;
    let detailPreviousVisitTime = 0;

    function getStoredValue(key, defaultValue) {
        if (typeof GM_getValue === 'function') {
            return GM_getValue(key, defaultValue);
        }
        return localStorage.getItem(key) || defaultValue;
    }

    function setStoredValue(key, value) {
        if (typeof GM_setValue === 'function') {
            GM_setValue(key, value);
        }
        localStorage.setItem(key, value);
    }

    function deleteStoredValue(key) {
        if (typeof GM_deleteValue === 'function') {
            GM_deleteValue(key);
        }
        localStorage.removeItem(key);
    }

    function parseJsonValue(value, defaultValue) {
        if (!value) return defaultValue;

        for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
            const text = value.trim();
            if (!text) return defaultValue;
            value = JSON.parse(text);
        }

        return value && typeof value === 'object' ? value : defaultValue;
    }

    function loadJsonValue(key, defaultValue) {
        try {
            return parseJsonValue(getStoredValue(key, JSON.stringify(defaultValue)), defaultValue);
        } catch (error) {
            console.warn(`Failed to load SupJAV JSON value: ${key}`, error);
            return defaultValue;
        }
    }

    function saveJsonValue(key, value) {
        setStoredValue(key, JSON.stringify(value));
    }

    function loadSettings() {
        const savedSettings = loadJsonValue(STORAGE_KEY, {});
        return normalizeSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
    }

    function normalizeSettings(value) {
        const displayMode = Object.values(DISPLAY_MODES).includes(value.displayMode)
            ? value.displayMode
            : (value.hideVisited === false ? DISPLAY_MODES.SHOW : DISPLAY_MODES.HIDE);
        return { ...value, displayMode };
    }

    function saveSettings() {
        saveJsonValue(STORAGE_KEY, settings);
    }

    function loadVisitedMap() {
        return loadJsonValue(VISITED_KEY, {});
    }

    function saveVisitedMap(visitedMap) {
        const cutoff = Date.now() - VISITED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
        const normalizedMap = normalizeVisitedMap(visitedMap);
        const ids = Object.keys(normalizedMap).filter(id => normalizedMap[id] > cutoff);

        if (ids.length > VISITED_MAX_COUNT) {
            ids.sort((a, b) => normalizedMap[b] - normalizedMap[a]);
            ids.length = VISITED_MAX_COUNT;
        }

        const trimmed = {};
        ids.forEach(id => {
            trimmed[id] = normalizedMap[id];
        });
        saveJsonValue(VISITED_KEY, trimmed);
    }

    function normalizeVisitedMap(visitedMap) {
        if (!visitedMap || typeof visitedMap !== 'object') return {};

        return Object.keys(visitedMap).reduce((result, rawId) => {
            const id = normalizeItemId(rawId);
            const timestamp = Number(visitedMap[rawId]);
            if (id && Number.isFinite(timestamp)) result[id] = timestamp;
            return result;
        }, {});
    }

    function normalizeItemId(value) {
        return String(value || '')
            .trim()
            .replace(/^\/+|\/+$/g, '')
            .toUpperCase();
    }

    function getPathSlug(pathname) {
        const slug = decodeURIComponent(pathname || '')
            .split('/')
            .filter(Boolean)
            .pop() || '';
        return normalizeItemId(slug.replace(/\.html$/i, ''));
    }

    function isDetailPath(pathname) {
        return /^\/(?:[a-z]{2}\/)?\d+\.html$/i.test(pathname || '');
    }

    function isSkippableSlug(slug) {
        const skippable = new Set([
            '', 'HOME', 'CATEGORY', 'TAG', 'STAR', 'ACTRESS',
            'SEARCH', 'PAGE', 'GENRE', 'DMCA', 'CONTACT', 'ABOUT'
        ]);
        return skippable.has(slug);
    }

    function isDetailPage() {
        const slug = getPathSlug(location.pathname);
        return Boolean(slug && isDetailPath(location.pathname));
    }

    function isListPage() {
        return !isDetailPage();
    }

    function markVisited(id) {
        if (!id || isSkippableSlug(id)) return 0;

        const visitedMap = loadVisitedMap();
        const previousVisitTime = Number(visitedMap[id]) || 0;
        visitedMap[id] = Date.now();
        saveVisitedMap(visitedMap);
        return previousVisitTime;
    }

    function isVisited(id, visitedMap) {
        return Boolean(id && visitedMap[id]);
    }

    function clearVisitedRecords() {
        deleteStoredValue(VISITED_KEY);
    }

    function cleanupVisitedRecords() {
        saveVisitedMap(loadVisitedMap());
    }

    function getVisitedStats() {
        const visitedMap = loadVisitedMap();
        return Object.keys(visitedMap).reduce((stats, id) => {
            stats.count += 1;
            stats.latestTime = Math.max(stats.latestTime, visitedMap[id] || 0);
            return stats;
        }, { count: 0, latestTime: 0 });
    }

    function showVisitedStats() {
        const stats = getVisitedStats();
        const latestText = stats.latestTime ? new Date(stats.latestTime).toLocaleString() : '无';
        alert(`SupJAV 已访问记录：${stats.count} 条
最近访问：${latestText}
自动清理：超过 ${VISITED_MAX_AGE_DAYS} 天`);
    }

    function getItemIdFromQuery(value) {
        const text = String(value || '').trim();
        if (!text) return '';

        try {
            const url = new URL(text, location.origin);
            if (isSameSiteUrl(url) && isDetailPath(url.pathname)) return getPathSlug(url.pathname);
        } catch (error) {
            return normalizeItemId(text);
        }

        return normalizeItemId(text);
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
        const query = getItemIdFromQuery(queryInput && queryInput.value);
        if (!query || isSkippableSlug(query)) {
            alert('请输入有效的 SupJAV 编号或详情页链接');
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

    function recordDetailPage() {
        if (!isDetailPage()) return;

        detailPreviousVisitTime = markVisited(getPathSlug(location.pathname));
    }

    function isSameSiteUrl(url) {
        return url.hostname === 'supjav.com' || url.hostname === 'www.supjav.com';
    }

    function showDetailVisitedMark() {
        const existingBadge = document.getElementById(DETAIL_BADGE_ID);
        if (!isDetailPage() || !document.body) {
            if (existingBadge) existingBadge.remove();
            return;
        }

        const id = getPathSlug(location.pathname);
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

    function findItemContainer(link) {
        const itemContainer = link.closest('article, .post, .item, .movie, .video, .col, .card, li, tr');
        return itemContainer || link.closest('div') || link;
    }

    function getItemIdFromLink(link) {
        try {
            const url = new URL(link.getAttribute('href'), location.origin);
            if (!isSameSiteUrl(url) || !isDetailPath(url.pathname)) return '';
            return getPathSlug(url.pathname);
        } catch (error) {
            return '';
        }
    }

    function ensureMarkStyle() {
        if (document.getElementById('supjav-visited-filter-style')) return;

        const style = document.createElement('style');
        style.id = 'supjav-visited-filter-style';
        style.textContent = `
            .supjav-visited-filter-marked {
                background: rgba(255, 152, 0, 0.18) !important;
                box-shadow: inset 0 0 0 2px #FF9800 !important;
                position: relative !important;
            }
        `;
        document.head.appendChild(style);
    }

    function getListItems() {
        const visitedMap = loadVisitedMap();
        const items = new Map();

        document.querySelectorAll('a[href]').forEach(link => {
            const id = getItemIdFromLink(link);
            if (!id || isSkippableSlug(id)) return;
            const container = findItemContainer(link);
            if (!container || items.has(container)) return;
            items.set(container, {
                id,
                visited: isVisited(id, visitedMap)
            });
        });

        return Array.from(items.entries()).map(([element, info]) => ({ element, ...info }));
    }

    function filterItems() {
        if (!isListPage()) return;

        let totalCount = 0;
        let visitedCount = 0;
        let hiddenCount = 0;
        getListItems().forEach(item => {
            totalCount += 1;
            if (item.visited) visitedCount += 1;

            const shouldHide = settings.displayMode === DISPLAY_MODES.HIDE && item.visited;
            const shouldMark = settings.displayMode === DISPLAY_MODES.MARK && item.visited;
            item.element.style.display = shouldHide ? 'none' : '';
            item.element.classList.toggle('supjav-visited-filter-marked', shouldMark);
            item.element.dataset.supjavVisitedFilterId = item.id;
            item.element.dataset.supjavVisited = item.visited ? 'true' : 'false';
            if (shouldHide) hiddenCount += 1;
        });

        updateStatus(totalCount, visitedCount, hiddenCount);
    }

    function updateStatus(totalCount, visitedCount, hiddenCount) {
        lastStats = { totalCount, visitedCount, hiddenCount };
        if (statusText) {
            statusText.textContent = [
                `已访问：${MODE_LABELS[settings.displayMode]}（${visitedCount}）`,
                `本页 ${totalCount} 项，隐藏 ${hiddenCount} 项`
            ].join('\n');
        }
        updateTriggerButton();
    }

    function getTriggerColor() {
        return MODE_COLORS[settings.displayMode] || '#607D8B';
    }

    function updateTriggerButton(stats = lastStats) {
        if (!triggerButton) return;

        const countText = stats ? ` ${stats.totalCount - stats.hiddenCount}/${stats.totalCount}` : '';
        triggerButton.textContent = `筛选${countText}`;
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
        triggerButton.title = '点击展开/收起面板，Alt+F 面板，Alt+V 已访问模式';
        triggerButton.addEventListener('click', togglePanel);
        document.body.appendChild(triggerButton);
        updateTriggerButton();
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
        filterItems();
        showDetailVisitedMark();
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

        if (onlyAlt && key === 'v') {
            event.preventDefault();
            cycleDisplayMode();
            return;
        }

        if (event.key === 'Escape') closePanel();
    }

    function togglePanel() {
        if (!panel) return;
        settings.panelVisible = !settings.panelVisible;
        panel.style.display = settings.panelVisible ? 'block' : 'none';
        saveSettings();
        updateTriggerButton();
    }

    function clearAllVisitedRecords() {
        if (!confirm('确定要清空所有 SupJAV 已访问记录吗？此操作不可撤销。')) return;
        clearVisitedRecords();
        filterItems();
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
        panel.style.minWidth = '260px';
        panel.style.display = settings.panelVisible ? 'block' : 'none';

        statusText = document.createElement('div');
        statusText.style.marginBottom = '10px';
        statusText.style.whiteSpace = 'pre-line';

        modeButton = createButton('', '#FF9800');
        queryInput = createQueryInput('编号或详情页链接');
        const queryButton = createButton('查询', '#2196F3');
        const statsButton = createButton('查看统计', '#2196F3');
        const clearButton = createButton('清空记录', '#607D8B');
        clearButton.title = '危险操作：清空全部已访问记录';
        clearButton.style.fontSize = '12px';
        clearButton.style.opacity = '0.8';

        modeButton.addEventListener('click', cycleDisplayMode);
        queryButton.addEventListener('click', queryVisitedRecord);
        queryInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') queryVisitedRecord();
        });
        statsButton.addEventListener('click', showVisitedStats);
        clearButton.addEventListener('click', clearAllVisitedRecords);

        panel.appendChild(statusText);
        panel.appendChild(modeButton);
        panel.appendChild(statsButton);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(document.createElement('br'));
        panel.appendChild(queryInput);
        panel.appendChild(queryButton);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(document.createElement('br'));
        panel.appendChild(clearButton);
        document.body.appendChild(panel);

        ensureMarkStyle();
        updateModeButton();
    }

    function watchListChanges() {
        if (!isListPage() || !document.body) return;

        let filterTimer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(filterItems, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function init() {
        cleanupVisitedRecords();
        recordDetailPage();
        showDetailVisitedMark();
        createTriggerButton();
        createPanel();
        filterItems();
        watchListChanges();
        document.addEventListener('keydown', handleKeyboardShortcuts);
    }

    init();
})();

