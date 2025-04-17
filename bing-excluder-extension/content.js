// 注意：这里不需要 Tampermonkey 的 // ==UserScript== ... // ==/UserScript== 部分

(function () {
    'use strict';

    // --- Configuration ---
    const DEBUG = true; // 设置为 true 会在控制台打印详细日志，方便调试 (建议先开启)
    const DELAY_BEFORE_CLEANING_INPUT = 300; // (新增) 清理输入框前的延迟时间 (毫秒)

    // ✅ 自定义黑名单列表（想屏蔽的域名加在这里）
    const blacklist = [
        'csdn.net',
        'zhihu.com',
        'baidu.com'
        // 添加更多你想屏蔽的域名...
    ];

    // --- Constants ---
    const SEARCH_INPUT_SELECTOR = 'input[name="q"], textarea[name="q"]'; // (更新) 尝试兼容 textarea 输入框
    const SEARCH_FORM_SELECTOR = 'form#sb_form, form[role="search"]';
    const BING_SEARCH_PATH = '/search'; // Bing 搜索的基础路径
    const DEFAULT_FORM_PARAM = 'QBRE'; // 一个常见的 Bing 搜索 form 参数默认值

    // --- Pre-calculated Values ---
    const exclusionParts = blacklist.map(domain => `-site:${domain.trim().toLowerCase()}`);
    const cleaningRegexParts = exclusionParts.map(part => {
        const escapedPart = part.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
         return new RegExp(`(?:\\s+|^)${escapedPart}(?:\\s+|$)`, 'gi');
    });

    // --- Helper Functions ---
    function log(...args) {
        if (DEBUG) {
            console.log('[Bing Excluder Ext]', ...args); // 稍微改下前缀区分
        }
    }

    function waitForElement(selector, callback, timeout = 5000) {
        const element = document.querySelector(selector);
        if (element) {
            log(`元素已存在: ${selector}`);
            callback(element);
            return;
        }
        let observer = null;
        let timeoutId = null;
        const cleanup = () => {
            if (observer) observer.disconnect();
            if (timeoutId) clearTimeout(timeoutId);
            observer = null; timeoutId = null;
            log(`观察器已停止: ${selector}`);
        };
        observer = new MutationObserver((mutations, obs) => {
            const targetElement = document.querySelector(selector);
            if (targetElement) {
                log(`通过观察器找到元素: ${selector}`);
                cleanup();
                callback(targetElement);
            }
        });
        log(`正在等待元素: ${selector}`);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        timeoutId = setTimeout(() => {
            if (observer) {
               log(`在 ${timeout}ms 内未找到元素: ${selector}`);
               cleanup();
            }
        }, timeout);
    }

    function getCleanQuery(fullQuery) {
        if (!fullQuery) return '';
        let cleanQuery = ` ${fullQuery} `;
        log('开始清理查询:', cleanQuery);
        cleaningRegexParts.forEach((regex, index) => {
            cleanQuery = cleanQuery.replace(regex, ' ');
            log(`移除 ${exclusionParts[index]} 后:`, cleanQuery);
        });
        cleanQuery = cleanQuery.replace(/\s\s+/g, ' ').trim();
        log('最终清理结果:', cleanQuery);
        return cleanQuery;
    }

    // --- Core Logic ---
    function handlePageLoad() {
        const currentUrl = new URL(window.location.href);
        const searchParams = currentUrl.searchParams;
        const query = searchParams.get('q');
        if (!query) {
            log('页面加载时未发现 q 查询参数.');
            return false;
        }
        log('URL 初始查询:', query);
        const queryLower = query.toLowerCase();
        const missingExclusions = exclusionParts.filter(part => !queryLower.includes(part));
        if (missingExclusions.length > 0) {
            log('发现缺失的排除项:', missingExclusions);
            let queryNeedsUpdate = query;
            if (queryNeedsUpdate.length > 0 && !queryNeedsUpdate.endsWith(' ')) {
                 queryNeedsUpdate += ' ';
            }
            queryNeedsUpdate += missingExclusions.join(' ');
            queryNeedsUpdate = queryNeedsUpdate.trim();
            log('准备重定向. 新查询:', queryNeedsUpdate);
            searchParams.set('q', queryNeedsUpdate);
            const preservedParams = ['form', 'pc', 'cvid', 'showconv']; // 确保保留必要的参数
            preservedParams.forEach(p => {
                 const currentValue = currentUrl.searchParams.get(p);
                 if(currentValue !== null && !searchParams.has(p)) { // 检查原始 URL 是否有该参数
                     searchParams.set(p, currentValue);
                 }
            });
            // 移除可能导致问题的空参数 (有时 Bing 会添加空参数)
            const keysToRemove = [];
            for (const [key, value] of searchParams.entries()) {
                 if (value === '') {
                     keysToRemove.push(key);
                 }
            }
            keysToRemove.forEach(key => searchParams.delete(key));

            const newUrl = `${currentUrl.pathname}?${searchParams.toString()}${currentUrl.hash}`;
            log('将重定向至:', newUrl);
            window.location.replace(newUrl);
            return true; // 表示已重定向
        } else {
            log('URL 中已包含所有排除项.');
            const cleanQuery = getCleanQuery(query);
            waitForElement(SEARCH_INPUT_SELECTOR, (input) => {
                log(`找到输入框元素:`, input);
                // --- 主要修改在这里 ---
                log(`计划在 ${DELAY_BEFORE_CLEANING_INPUT}ms 后清理输入框为:`, cleanQuery);
                setTimeout(() => {
                    const currentValue = input.value; // 获取延迟后的当前值
                    log(`延迟 ${DELAY_BEFORE_CLEANING_INPUT}ms 后，输入框当前值为:`, currentValue);
                    if (currentValue !== cleanQuery) {
                        log(`值不匹配，执行更新为:`, cleanQuery);
                        input.value = cleanQuery;
                        // 尝试触发事件，模拟用户输入或更改，可能有助于某些框架识别变化
                        log('触发 input 和 change 事件');
                        input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                        // 有些现代框架可能监听 keyup 或 blur
                        // input.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
                        // input.dispatchEvent(new FocusEvent('blur', { bubbles: true, cancelable: true }));

                        // 再次检查是否成功修改
                        if(input.value === cleanQuery) {
                            log('输入框值已成功更新为清理后的查询。');
                        } else {
                            log('警告：尝试更新输入框值后，值仍未变为预期值。可能被其他脚本覆盖。当前值:', input.value);
                        }
                    } else {
                         log('延迟后检查，输入框值已与清理后查询一致，无需操作。');
                    }
                }, DELAY_BEFORE_CLEANING_INPUT); // 使用配置的延迟时间
                // --- 修改结束 ---
            });
            return false; // 表示未重定向
        }
    }

    function handleFormSubmit() {
        waitForElement(SEARCH_FORM_SELECTOR, (form) => {
            log('搜索表单已找到:', form);
            form.addEventListener('submit', (event) => {
                log('捕获到表单提交事件.');
                const input = form.querySelector(SEARCH_INPUT_SELECTOR);
                if (!input) { log('在表单中未找到搜索输入框.'); return; }
                const userInput = input.value.trim();
                // 不再需要检查 userInput 是否为空，因为即使用户清空了，我们也应该加上排除项进行空搜索
                // if (!userInput) { log('用户输入为空，允许默认提交.'); return; }
                log('用户输入 (来自输入框的值):', userInput);

                // 阻止默认提交，我们要自己构建 URL
                event.preventDefault();
                event.stopPropagation(); // 尝试阻止其他可能的监听器

                let targetQuery = userInput; // 从（可能已被清理的）输入框获取基础查询
                const userInputLower = userInput.toLowerCase(); // 用于检查是否已存在（不太可能，因为我们清理了）

                // 添加所有必要的排除项
                exclusionParts.forEach(part => {
                    // 理论上 userInput 应该是干净的，所以直接添加，但以防万一还是检查下
                    if (!userInputLower.includes(part.toLowerCase())) {
                         // 在添加前确保有空格分隔
                         if (targetQuery.length > 0 && !targetQuery.endsWith(' ')) {
                             targetQuery += ' ';
                         }
                         targetQuery += part;
                    }
                });

                targetQuery = targetQuery.trim(); // 清理可能多余的空格
                log('构建的目标查询 (含排除项):', targetQuery);

                // 构建新的 URL
                const newUrl = new URL(window.location.origin);
                newUrl.pathname = BING_SEARCH_PATH;
                newUrl.searchParams.set('q', targetQuery);

                // 保留重要的现有参数
                const currentParams = new URLSearchParams(window.location.search);
                const paramsToPreserve = ['form', 'pc', 'cvid', 'showconv']; // 参数列表
                paramsToPreserve.forEach(p => {
                    if (currentParams.has(p)) {
                        newUrl.searchParams.set(p, currentParams.get(p));
                    }
                });
                // 如果 form 参数丢失，尝试使用默认值
                if (!newUrl.searchParams.has('form') && currentParams.has('form')) {
                    newUrl.searchParams.set('form', currentParams.get('form'));
                } else if (!newUrl.searchParams.has('form')) {
                     newUrl.searchParams.set('form', DEFAULT_FORM_PARAM);
                }


                log('准备导航至新 URL:', newUrl.toString());
                window.location.href = newUrl.toString(); // 使用 href 进行导航

            }, true); // 使用捕获阶段，尝试先于页面自身的提交处理
        });
    }

    // --- Execution ---
    log('脚本开始执行...');
    // 确保在 Bing 搜索结果页执行
    if (window.location.pathname === BING_SEARCH_PATH || window.location.pathname.startsWith('/search')) {
        log('当前页面是 Bing 搜索结果页，继续执行。');
        const redirected = handlePageLoad();
        if (!redirected) {
            log('页面加载时未重定向，设置表单提交监听器。');
            handleFormSubmit();
        } else {
             log('页面加载时已发起重定向，脚本将在新页面重新运行。');
        }
    } else {
        log('当前页面不是 Bing 搜索结果页 (' + window.location.pathname + ')，脚本不执行核心逻辑。');
    }


})(); // 立即执行函数结束