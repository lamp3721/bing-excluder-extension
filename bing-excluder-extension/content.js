// 注意：这里不需要 Tampermonkey 的 // ==UserScript== ... // ==/UserScript== 部分

(function () {
    'use strict';

    // --- Configuration ---
    const DEBUG = true; // 设置为 true 会在控制台打印详细日志 (建议调试时开启)
    const DELAY_BEFORE_CLEANING_INPUT = 300; // 清理输入框前的延迟 (毫秒)，用于应对 Bing 脚本可能的覆盖
    const INPUT_CLEANUP_TIMEOUT = 5000; // 等待输入框元素以进行清理的最长时间 (毫秒)
    const FORM_WAIT_TIMEOUT = 5000;     // 等待搜索表单元素的最长时间 (毫秒)

    // ✅ 自定义黑名单列表（想屏蔽的域名加在这里）
    const blacklist = [
        'csdn.net',
        'zhihu.com',
        'baidu.com'
        // 添加更多你想屏蔽的域名...
    ];

    // --- Constants ---
    const SEARCH_INPUT_SELECTOR = 'input[name="q"], textarea[name="q"]'; // 搜索输入框选择器
    const SEARCH_FORM_SELECTOR = 'form#sb_form, form[role="search"]';   // 搜索表单选择器
    const BING_SEARCH_PATH = '/search';                                // Bing 搜索的基础路径
    const DEFAULT_FORM_PARAM = 'QBRE';                                 // 默认的 'form' 参数值
    const PARAMS_TO_PRESERVE = ['form', 'pc', 'cvid', 'showconv'];    // 重定向/提交时需要保留的 URL 参数

    // --- Pre-calculated Values ---
    // 生成排除字符串，例如: -site:csdn.net
    const EXCLUSION_STRINGS = blacklist.map(domain => `-site:${domain.trim().toLowerCase()}`);
    // 生成用于清理查询的正则表达式 (更精确地匹配，避免部分匹配)
    const CLEANING_REGEXES = EXCLUSION_STRINGS.map(part => {
        // 转义特殊字符
        const escapedPart = part.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        // 匹配前后是空格或字符串开头/结尾，确保匹配整个排除项
        return new RegExp(`(?:\\s+|^)${escapedPart}(?:\\s+|$)`, 'gi');
    });
    // 用于检查 URL 或输入值是否已包含排除项 (性能稍好于多次 includes)
    const EXCLUSION_CHECK_REGEX = new RegExp(EXCLUSION_STRINGS.map(part =>
        part.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') // 转义
    ).join('|'), 'i'); // i: Case-insensitive

    // --- Helper Functions ---
    function log(...args) {
        if (DEBUG) {
            // 使用 console.group/groupEnd 可以更好地组织调试信息
            console.groupCollapsed(`[Bing Excluder] ${args[0]}`);
            if (args.length > 1) {
                 console.log(...args.slice(1));
            }
            console.trace(); // 显示调用栈，方便追踪
            console.groupEnd();
        }
    }

    /**
     * 等待指定选择器的元素出现，并在找到后执行回调。
     * @param {string} selector - CSS 选择器
     * @param {function(HTMLElement)} callback - 找到元素后执行的回调函数
     * @param {number} timeout - 超时时间 (毫秒)
     * @param {string} [context='Element'] - 用于日志记录的上下文名称
     */
    function waitForElement(selector, callback, timeout, context = 'Element') {
        const element = document.querySelector(selector);
        if (element) {
            log(`[waitForElement] ${context} 已存在: ${selector}`);
            callback(element);
            return;
        }

        let observer = null;
        let timeoutId = null;

        const cleanup = () => {
            if (observer) observer.disconnect();
            if (timeoutId) clearTimeout(timeoutId);
            observer = null;
            timeoutId = null;
            log(`[waitForElement] ${context} 观察器已停止: ${selector}`);
        };

        observer = new MutationObserver((mutations, obs) => {
            const targetElement = document.querySelector(selector);
            if (targetElement) {
                log(`[waitForElement] 通过观察器找到 ${context}: ${selector}`);
                cleanup();
                callback(targetElement);
            }
        });

        log(`[waitForElement] 正在等待 ${context}: ${selector}`);
        observer.observe(document.documentElement, { childList: true, subtree: true });

        timeoutId = setTimeout(() => {
            if (observer) {
               log(`[waitForElement] 在 ${timeout}ms 内未找到 ${context}: ${selector}`);
               cleanup();
            }
        }, timeout);
    }

    /**
     * 从包含排除项的完整查询中，移除所有排除项，得到干净的查询。
     * @param {string} fullQuery - 包含排除项的查询字符串
     * @returns {string} 清理后的查询字符串
     */
    function getCleanQuery(fullQuery) {
        if (!fullQuery) return '';
        // 包裹空格是为了让正则表达式能正确匹配开头/结尾的排除项
        let cleanQuery = ` ${fullQuery} `;
        log('[getCleanQuery] 开始清理查询:', `"${cleanQuery}"`);
        CLEANING_REGEXES.forEach((regex, index) => {
            const before = cleanQuery;
            cleanQuery = cleanQuery.replace(regex, ' '); // 替换为空格，而不是空字符串
            if (before !== cleanQuery) {
                 log(`[getCleanQuery] 移除了 ${EXCLUSION_STRINGS[index]}:`, `"${cleanQuery}"`);
            }
        });
        // 移除多余的空格并去除首尾空格
        cleanQuery = cleanQuery.replace(/\s\s+/g, ' ').trim();
        log('[getCleanQuery] 最终清理结果:', `"${cleanQuery}"`);
        return cleanQuery;
    }

    /**
     * 将必要的 URL 参数从源 URL 复制到目标 URLSearchParams 对象。
     * @param {URLSearchParams} targetParams - 目标 URLSearchParams 对象
     * @param {URLSearchParams} sourceParams - 源 URLSearchParams 对象
     */
    function preserveUrlParams(targetParams, sourceParams) {
        PARAMS_TO_PRESERVE.forEach(p => {
            const value = sourceParams.get(p);
            // 仅当源 URL 中存在该参数且目标中尚无该参数时才复制
            if (value !== null && !targetParams.has(p)) {
                targetParams.set(p, value);
                log('[preserveUrlParams] 保留参数:', p, '=', value);
            }
        });
        // 特殊处理 'form' 参数：如果目标没有，尝试从源获取，再不行用默认值
        if (!targetParams.has('form')) {
            const formValue = sourceParams.get('form') ?? DEFAULT_FORM_PARAM;
            targetParams.set('form', formValue);
            log('[preserveUrlParams] 设置 form 参数:', formValue);
        }
    }

    /**
     * 移除 URLSearchParams 对象中的空值参数。
     * @param {URLSearchParams} params - 要清理的 URLSearchParams 对象
     */
    function removeEmptyParams(params) {
        const keysToRemove = [];
        for (const [key, value] of params.entries()) {
             if (value === '') {
                 keysToRemove.push(key);
             }
        }
        keysToRemove.forEach(key => {
            params.delete(key);
            log('[removeEmptyParams] 移除空参数:', key);
        });
    }


    // --- Core Logic ---

    /**
     * 处理页面加载：检查 URL 是否需要添加排除项并重定向，
     * 或清理已加载页面的搜索输入框。
     * @returns {boolean} 如果执行了重定向则返回 true，否则返回 false。
     */
    function handlePageLoad() {
        const currentUrl = new URL(window.location.href);
        const searchParams = currentUrl.searchParams;
        const query = searchParams.get('q');

        if (!query) {
            log('[handlePageLoad] URL 中未发现 "q" 查询参数，无需操作。');
            return false;
        }

        log('[handlePageLoad] URL 初始查询:', `"${query}"`);
        const queryLower = query.toLowerCase();

        // 检查是否所有排除项都已存在于查询中
        const missingExclusions = EXCLUSION_STRINGS.filter(part => !queryLower.includes(part.toLowerCase()));

        if (missingExclusions.length > 0) {
            // --- 需要重定向 ---
            log('[handlePageLoad] 发现缺失的排除项:', missingExclusions);

            let queryNeedsUpdate = query.trim();
            const exclusionsToAdd = missingExclusions.join(' ');

            // 构建新的查询字符串
            if (queryNeedsUpdate) {
                // 确保现有查询和新排除项之间只有一个空格
                queryNeedsUpdate += ' ' + exclusionsToAdd;
            } else {
                queryNeedsUpdate = exclusionsToAdd; // 如果原始查询为空，则直接使用排除项
            }

            log('[handlePageLoad] 准备重定向. 新查询:', `"${queryNeedsUpdate}"`);

            // 创建新的 URLSearchParams 进行修改，避免直接修改原始 searchParams
            const newSearchParams = new URLSearchParams();
            newSearchParams.set('q', queryNeedsUpdate);

            // 保留必要的参数
            preserveUrlParams(newSearchParams, searchParams);

            // 移除可能导致问题的空参数
            removeEmptyParams(newSearchParams);

            const newUrl = `${currentUrl.pathname}?${newSearchParams.toString()}${currentUrl.hash}`;
            log('[handlePageLoad] 将重定向至:', newUrl);
            window.location.replace(newUrl); // 使用 replace 避免污染浏览器历史记录
            return true; // 表示已重定向

        } else {
            // --- 无需重定向，清理输入框 ---
            log('[handlePageLoad] URL 中已包含所有排除项，尝试清理输入框。');
            const cleanQuery = getCleanQuery(query);

            waitForElement(SEARCH_INPUT_SELECTOR, (input) => {
                log(`[handlePageLoad] 找到输入框元素:`, input);
                log(`[handlePageLoad] 计划在 ${DELAY_BEFORE_CLEANING_INPUT}ms 后清理输入框为:`, `"${cleanQuery}"`);

                // 使用 setTimeout 延迟执行，给 Bing 可能的 JS 留出时间先填充输入框
                // 这是处理与目标页面脚本竞态条件的常见（但不完美）策略
                setTimeout(() => {
                    const currentValue = input.value;
                    log(`[handlePageLoad] 延迟 ${DELAY_BEFORE_CLEANING_INPUT}ms 后，输入框当前值为:`, `"${currentValue}"`);

                    // 只有当当前值与目标干净值不同时才更新
                    if (currentValue !== cleanQuery) {
                        log(`[handlePageLoad] 值不匹配，执行更新为:`, `"${cleanQuery}"`);
                        input.value = cleanQuery;

                        // 尝试触发事件，模拟用户输入或更改，通知页面框架
                        log('[handlePageLoad] 触发 input 和 change 事件');
                        input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

                        // 验证更新是否成功
                        if (input.value === cleanQuery) {
                            log('[handlePageLoad] 输入框值已成功更新。');
                        } else {
                            // 如果值又变了，很可能是被 Bing 的其他脚本覆盖了
                            log('[handlePageLoad] 警告：尝试更新输入框值后，值未能保持。可能被页面其他脚本覆盖。当前值:', `"${input.value}"`);
                        }
                    } else {
                         log('[handlePageLoad] 延迟后检查，输入框值已与清理后查询一致，无需操作。');
                    }
                }, DELAY_BEFORE_CLEANING_INPUT);

            }, INPUT_CLEANUP_TIMEOUT, 'Search Input for Cleanup'); // 使用特定的超时和上下文

            return false; // 表示未重定向
        }
    }

    /**
     * 处理搜索表单提交：阻止默认提交，强制添加所有排除项到查询中，然后导航。
     */
    function handleFormSubmit() {
        waitForElement(SEARCH_FORM_SELECTOR, (form) => {
            log('[handleFormSubmit] 搜索表单已找到:', form);

            // 使用捕获阶段监听，尝试在页面默认处理前执行
            form.addEventListener('submit', (event) => {
                log('[handleFormSubmit] 捕获到表单提交事件。');
                const input = form.querySelector(SEARCH_INPUT_SELECTOR);
                if (!input) {
                    log('[handleFormSubmit] 错误: 在表单中未找到搜索输入框。取消操作。');
                    return; // 提前返回，避免后续错误
                }

                const userInput = input.value.trim(); // 获取用户输入的（可能是清理过的）查询
                log('[handleFormSubmit] 用户输入 (来自输入框):', `"${userInput}"`);

                // 阻止默认表单提交行为
                event.preventDefault();
                event.stopPropagation(); // 同时阻止事件冒泡

                let targetQuery = userInput;
                const currentQueryLower = targetQuery.toLowerCase();

                // 找出尚未包含在当前输入中的排除项
                // （理论上输入框应该是干净的，所以这里会添加所有排除项，但检查增加健壮性）
                const neededExclusions = EXCLUSION_STRINGS.filter(part => !currentQueryLower.includes(part.toLowerCase()));

                if (neededExclusions.length > 0) {
                    const exclusionsToAdd = neededExclusions.join(' ');
                    if (targetQuery) {
                        // 在现有查询和排除项之间加一个空格
                        targetQuery += ' ' + exclusionsToAdd;
                    } else {
                        // 如果输入为空，则查询就是所有排除项
                        targetQuery = exclusionsToAdd;
                    }
                    log('[handleFormSubmit] 添加了缺失的排除项:', neededExclusions);
                } else {
                    log('[handleFormSubmit] 用户输入中已包含所有排除项（或输入为空且无需添加）。');
                }

                // 最终确保查询是 trim 过的 (虽然理论上应该已经是)
                targetQuery = targetQuery.trim();
                log('[handleFormSubmit] 构建的目标查询 (含所有排除项):', `"${targetQuery}"`);

                // --- 构建新的搜索 URL ---
                const newUrl = new URL(window.location.origin); // 基于当前域名
                newUrl.pathname = BING_SEARCH_PATH;            // 设置搜索路径
                const newSearchParams = newUrl.searchParams;   // 获取 searchParams 对象
                newSearchParams.set('q', targetQuery);        // 设置查询参数

                // 保留来自当前页面 URL 的重要参数
                const currentParams = new URLSearchParams(window.location.search);
                preserveUrlParams(newSearchParams, currentParams);

                // 移除可能产生的空参数
                removeEmptyParams(newSearchParams);

                const finalUrl = newUrl.toString();
                log('[handleFormSubmit] 准备导航至新 URL:', finalUrl);
                window.location.href = finalUrl; // 使用 href 进行导航，模拟用户操作

            }, true); // true 表示使用捕获阶段

        }, FORM_WAIT_TIMEOUT, 'Search Form'); // 使用特定的超时和上下文
    }

    // --- Execution ---
    log('脚本开始执行...');

    // 确保在 Bing 搜索结果页或其变体上执行
    if (window.location.pathname === BING_SEARCH_PATH || window.location.pathname.startsWith(BING_SEARCH_PATH + '/')) {
        log('当前页面是 Bing 搜索结果页，继续执行核心逻辑。');
        const redirected = handlePageLoad(); // 执行页面加载处理

        if (!redirected) {
            // 如果页面加载时没有发生重定向，说明 URL 已符合要求（或无需操作）
            // 此时需要设置表单提交监听器，以处理用户进行的下一次搜索
            log('页面加载时未重定向，设置表单提交监听器。');
            handleFormSubmit();
        } else {
             // 如果页面加载时触发了重定向，脚本将在新页面重新加载并再次运行
             log('页面加载时已发起重定向，脚本将在新页面重新运行，本次执行结束。');
        }
    } else {
        log('当前页面不是 Bing 搜索结果页 (' + window.location.pathname + ')，脚本不执行核心逻辑。');
    }

})(); // 立即执行函数结束