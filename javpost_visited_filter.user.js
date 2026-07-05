// ==UserScript==
// @name         JavPost Visited Item Filter
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Record visited JavPost detail pages and hide or show visited items on the new release list
// @author       qisexin
// @license      MIT
// @match        https://www.javpost.net/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://github.com/qisexin/sukebei_filter/raw/main/javpost_visited_filter.user.js
// @downloadURL  https://github.com/qisexin/sukebei_filter/raw/main/javpost_visited_filter.user.js
// @supportURL   https://github.com/qisexin/sukebei_filter/issues
// @homepageURL  https://github.com/qisexin/sukebei_filter
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'javpostVisitedFilterSettings';
    const VISITED_KEY = 'javpostVisitedItems';
    const VISITED_MAX_AGE_DAYS = 180;
    const VISITED_MAX_COUNT = 10000;
    const RELEASE_NEW_PATH = '/release/new/';
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
        displayMode: DISPLAY_MODES.HIDE,
        panelVisible: true
    };

    let settings = loadSettings();
    let panel;
    let statusText;
    let toggleButton;

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

    function loadJsonValue(key, defaultValue) {
        try {
            return JSON.parse(getStoredValue(key, JSON.stringify(defaultValue)) || JSON.stringify(defaultValue));
        } catch (error) {
            console.warn(`Failed to load JavPost JSON value: ${key}`, error);
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
        const ids = Object.keys(visitedMap).filter(id => visitedMap[id] > cutoff);

        if (ids.length > VISITED_MAX_COUNT) {
            ids.sort((a, b) => visitedMap[b] - visitedMap[a]);
            ids.length = VISITED_MAX_COUNT;
        }

        const trimmed = {};
        ids.forEach(id => {
            trimmed[id] = visitedMap[id];
        });
        saveJsonValue(VISITED_KEY, trimmed);
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
            .filter(Boolean)[0];
        return normalizeItemId(slug);
    }

    function isReleaseNewPage() {
        return location.pathname === RELEASE_NEW_PATH || location.pathname.startsWith(`${RELEASE_NEW_PATH}page/`);
    }

    function isSkippableSlug(slug) {
        const skippable = new Set(['', 'RELEASE', 'PAGE', 'SEARCH', 'GENRE', 'STAR', 'MAKER', 'LABEL']);
        return skippable.has(slug);
    }

    function markVisited(id) {
        if (!id || isSkippableSlug(id)) return;
        const visitedMap = loadVisitedMap();
        visitedMap[id] = Date.now();
        saveVisitedMap(visitedMap);
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
        alert(`JavPost 已访问记录：${stats.count} 条
最近访问：${latestText}
自动清理：超过 ${VISITED_MAX_AGE_DAYS} 天`);
    }

    function recordDetailPage() {
        if (isReleaseNewPage()) return;
        const id = getPathSlug(location.pathname);
        markVisited(id);
    }

    function findItemContainer(link) {
        return link.closest('article, .post, .item, .movie, .video, .col, .card, li, tr, div') || link;
    }

    function getItemIdFromLink(link) {
        try {
            const url = new URL(link.getAttribute('href'), location.origin);
            if (url.origin !== location.origin) return '';
            if (url.pathname === RELEASE_NEW_PATH || url.pathname.startsWith(RELEASE_NEW_PATH)) return '';
            return getPathSlug(url.pathname);
        } catch (error) {
            return '';
        }
    }

    function ensureMarkStyle() {
        if (document.getElementById('javpost-visited-filter-style')) return;

        const style = document.createElement('style');
        style.id = 'javpost-visited-filter-style';
        style.textContent = `
            .javpost-visited-filter-marked {
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
        if (!isReleaseNewPage()) return;

        let totalCount = 0;
        let visitedCount = 0;
        let hiddenCount = 0;
        getListItems().forEach(item => {
            totalCount += 1;
            if (item.visited) visitedCount += 1;

            const shouldHide = settings.displayMode === DISPLAY_MODES.HIDE && item.visited;
            const shouldMark = settings.displayMode === DISPLAY_MODES.MARK && item.visited;
            item.element.style.display = shouldHide ? 'none' : '';
            item.element.classList.toggle('javpost-visited-filter-marked', shouldMark);
            item.element.dataset.javpostVisitedFilterId = item.id;
            item.element.dataset.javpostVisited = item.visited ? 'true' : 'false';
            if (shouldHide) hiddenCount += 1;
        });

        updateStatus(totalCount, visitedCount, hiddenCount);
    }

    function updateStatus(totalCount, visitedCount, hiddenCount) {
        if (!statusText) return;
        statusText.textContent = `${MODE_LABELS[settings.displayMode]} | 本页 ${totalCount} 项，已访问 ${visitedCount} 项，隐藏 ${hiddenCount} 项`;
    }

    function updateToggleButton() {
        if (!toggleButton) return;
        toggleButton.textContent = `模式：${MODE_LABELS[settings.displayMode]}`;
        toggleButton.style.backgroundColor = MODE_COLORS[settings.displayMode];
    }

    function cycleDisplayMode() {
        const modes = [DISPLAY_MODES.HIDE, DISPLAY_MODES.SHOW, DISPLAY_MODES.MARK];
        const currentIndex = modes.indexOf(settings.displayMode);
        settings.displayMode = modes[(currentIndex + 1) % modes.length];
        saveSettings();
        updateToggleButton();
        filterItems();
    }

    function togglePanel() {
        if (!panel) return;
        settings.panelVisible = !settings.panelVisible;
        panel.style.display = settings.panelVisible ? 'block' : 'none';
        saveSettings();
    }

    function clearAllVisitedRecords() {
        if (!confirm('确定要清空所有 JavPost 已访问记录吗？此操作不可撤销。')) return;
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

    function createPanel() {
        if (!isReleaseNewPage() || !document.body) return;

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

        toggleButton = createButton('', '#9C27B0');
        const clearButton = createButton('清空记录', '#607D8B');

        toggleButton.addEventListener('click', cycleDisplayMode);
        clearButton.addEventListener('click', clearAllVisitedRecords);

        panel.appendChild(statusText);
        panel.appendChild(toggleButton);
        panel.appendChild(clearButton);
        document.body.appendChild(panel);

        ensureMarkStyle();
        updateToggleButton();
    }

    function watchListChanges() {
        if (!isReleaseNewPage() || !document.body) return;

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
        createPanel();
        filterItems();
        watchListChanges();

        GM_registerMenuCommand('切换 JavPost 已访问过滤面板', togglePanel);
        GM_registerMenuCommand('切换 JavPost 显示模式', cycleDisplayMode);
        GM_registerMenuCommand('查看 JavPost 已访问统计', showVisitedStats);
        GM_registerMenuCommand('清空 JavPost 已访问记录', clearAllVisitedRecords);
    }

    init();
})();

