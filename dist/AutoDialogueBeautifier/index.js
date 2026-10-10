/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./config/workshop.json
const workshop_namespaceObject = /*#__PURE__*/JSON.parse('{"Sn":{"mz":"2.3.1"},"_r":{"J":"AkabaneSaki/myrepo"}}');
;// ./src/AutoDialogueBeautifier/index.ts

// 自适应正则脚本
// 功能：AI输出完成后，检测最后一层聊天存在的表达式，将匹配的 scriptName 存入变量并排序
// 加载脚本/变量变化时，检查角色卡正则列表与变量列表，注册缺失的正则
// 卸载脚本时，根据列表卸载对应的正则
// 使用防抖机制（500ms）防止无限循环
// regex.json 网络链接列表（主URL + 备用CDN加速URL）
const REGEX_JSON_URLS = [
    'https://cdn.jsdelivr.net',
    'https://gcore.jsdelivr.net',
    'https://testingcf.jsdelivr.net',
].map(origin => `${origin}/gh/${workshop_namespaceObject._r.J}@${workshop_namespaceObject.Sn.mz}/regex.json`);
// 系统核心使用世界书写入聊天变量的名称；前缀不包含规则版本号。
const SYSTEM_REGEX_PREFIXES = {
    长颈鹿核心: ['长颈鹿核心', '长颈鹿对话美化'],
    '奥托·阿波卡利斯核心': ['命定核心-奥托'],
    类脑娘: ['命定核心-类脑娘'],
    '阿比盖尔核心-表': ['命定核心-阿比盖尔美化-表', '命定核心-阿比奖励技能'],
    '阿比盖尔核心-里': ['命定核心-阿比盖尔美化-里', '命定核心-阿比奖励技能'],
    妲丽安: ['命定核心-妲丽安'],
    奶龙核心: ['命定核心-奶龙'],
    小夜莺核心: ['命定核心-小夜莺'],
    艾莉亚: ['命定核心-艾莉亚'],
    莉莉丝: ['命定核心-莉莉丝'],
    九十九夜梦: ['读者对话渲染'],
};
const isSystemBeautifier = (name) => name.startsWith('命定核心-') || Object.values(SYSTEM_REGEX_PREFIXES).flat().some(prefix => name.startsWith(prefix));
const matchesSystemCore = (name, core) => SYSTEM_REGEX_PREFIXES[core]?.some(prefix => name.startsWith(prefix)) ?? false;
$(async () => {
    console.info('自适应正则脚本已加载');
    // ========== 加载网络 regex.json（支持备用CDN） ==========
    let regexData = [];
    try {
        console.info('自适应正则: 正在从网络加载 regex.json...');
        let loaded = false;
        for (let i = 0; i < REGEX_JSON_URLS.length; i++) {
            const url = REGEX_JSON_URLS[i];
            try {
                console.info(`自适应正则: 尝试从第 ${i + 1} 个URL加载: ${url}`);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                regexData = await response.json();
                console.info(`自适应正则: 成功从第 ${i + 1} 个URL加载 ${regexData.length} 条规则`);
                loaded = true;
                break;
            }
            catch (urlError) {
                console.warn(`自适应正则: 第 ${i + 1} 个URL加载失败:`, urlError);
                if (i < REGEX_JSON_URLS.length - 1) {
                    console.info('自适应正则: 尝试下一个备用URL...');
                }
            }
        }
        if (!loaded) {
            throw new Error('所有CDN URL均加载失败');
        }
    }
    catch (error) {
        console.error('自适应正则: 从网络加载失败:', error);
        toastr.error('自适应正则: 加载规则失败，请检查网络连接');
        return; // 加载失败时退出
    }
    // 聊天变量键名 - 存储当前应该注册的正则 scriptName 列表
    const VARIABLE_KEY = 'adaptive_regex_names';
    // 聊天变量键名 - 存储最后处理的消息ID
    const LAST_PROCESSED_MESSAGE_ID_KEY = 'adaptive_regex_last_message_id';
    // 同步锁，防止无限循环
    let isSyncing = false;
    // 自动检测临时注册的规则；手动更新和明确保留的规则不随脚本卸载删除。
    const automaticallyRegisteredNames = new Set();
    // 上次处理的聊天ID，用于防抖
    let lastChatId = null;
    // 防抖定时器
    let syncTimeout = null;
    // ========== 缓存机制 ==========
    // 缓存编译后的正则 patterns，避免每次消息都重新解析
    let cachedPatterns = null;
    // 缓存启用的正则规则
    let cachedEnabledRules = null;
    // 清除缓存（用于 regex.json 更新时）
    const clearCache = () => {
        cachedPatterns = null;
        cachedEnabledRules = null;
        console.info('自适应正则: 缓存已清除');
    };
    console.info(`自适应正则: 成功加载 ${regexData.length} 条规则`);
    // 从 regex.json 中获取有效的正则规则（带缓存）
    const getEnabledRegexRules = () => {
        if (cachedEnabledRules !== null) {
            return cachedEnabledRules;
        }
        cachedEnabledRules = regexData
            .filter((rule) => !rule.disabled)
            .map((rule) => ({
            id: rule.id,
            script_name: rule.scriptName,
            enabled: true,
            scope: 'character',
            find_regex: rule.findRegex,
            replace_string: rule.replaceString,
            trim_strings: Array.isArray(rule.trimStrings) ? [...rule.trimStrings] : [],
            source: {
                user_input: false,
                ai_output: true,
                slash_command: false,
                world_info: false,
                reasoning: false,
            },
            destination: {
                display: true,
                prompt: false,
            },
            run_on_edit: rule.runOnEdit ?? true,
            min_depth: rule.minDepth ?? null,
            max_depth: rule.maxDepth ?? 10,
        }));
        return cachedEnabledRules;
    };
    // 从 regex.json 提取检测模式（带缓存，避免每次消息都重新解析）
    const extractDetectionPatterns = () => {
        // 直接返回缓存，避免重复计算
        if (cachedPatterns !== null) {
            return cachedPatterns;
        }
        // 计算并缓存结果
        const result = regexData
            .filter((rule) => !rule.disabled)
            .map((rule) => {
            let patternStr = rule.findRegex;
            // 解析正则表达式，去除可能的 /pattern/flags 格式
            const match = patternStr.match(/^\/(.+)\/([gimsuy]*)$/);
            if (match) {
                patternStr = match[1];
            }
            try {
                const pattern = new RegExp(patternStr, 'i');
                let quickCheck = '';
                if (patternStr.includes('{') || patternStr.includes('\\{')) {
                    quickCheck = '{';
                }
                else if (patternStr.includes('<') || patternStr.includes('\\<')) {
                    const tagMatch = patternStr.match(/<(\w+)/);
                    if (tagMatch) {
                        quickCheck = `<${tagMatch[1]}`;
                    }
                }
                else if (patternStr.includes('\\[') || patternStr.includes('\\]')) {
                    quickCheck = '[';
                }
                else if (patternStr.includes('\\(') || patternStr.includes('\\)')) {
                    quickCheck = '(';
                }
                else if (patternStr.startsWith('>')) {
                    quickCheck = '>';
                }
                else if (patternStr.startsWith('<')) {
                    const firstTagMatch = patternStr.match(/<(\w+)/);
                    if (firstTagMatch) {
                        quickCheck = `<${firstTagMatch[1]}`;
                    }
                }
                else {
                    quickCheck = patternStr.substring(0, Math.min(15, patternStr.length));
                }
                return {
                    scriptName: rule.scriptName,
                    pattern,
                    quickCheck,
                };
            }
            catch (e) {
                console.warn(`无效的正则表达式: ${patternStr}`, e);
                return null;
            }
        })
            .filter(Boolean);
        // 存入缓存并返回
        cachedPatterns = result;
        return result;
    };
    // 检测消息中包含的需要处理的正则 scriptName
    // skipStoredNames: 已存储的正则名称列表，跳过这些正则的匹配检测
    const detectNeededScriptNames = (messageContent, skipStoredNames = []) => {
        if (!messageContent || messageContent.length < 3) {
            return [];
        }
        const patterns = extractDetectionPatterns();
        const neededNames = [];
        const skipSet = new Set(skipStoredNames);
        const core = getVariables({ type: 'chat' }).系统核心;
        for (const { scriptName, pattern, quickCheck } of patterns) {
            // 已选择系统核心时，避免旧对白重新装回用户刚移除的其他系统美化。
            if (typeof core === 'string' && SYSTEM_REGEX_PREFIXES[core]
                && isSystemBeautifier(scriptName) && !matchesSystemCore(scriptName, core)) {
                continue;
            }
            // 跳过已存储的正则（它们已经匹配过了，不需要再次检测）
            if (skipSet.has(scriptName)) {
                continue;
            }
            // 快速预检查
            if (quickCheck && !messageContent.includes(quickCheck)) {
                continue;
            }
            try {
                pattern.lastIndex = 0;
                if (pattern.test(messageContent)) {
                    neededNames.push(scriptName);
                    console.info(`自适应正则: 检测到 ${scriptName}`);
                }
            }
            catch (e) {
                // 忽略正则测试错误
            }
        }
        return neededNames;
    };
    // 获取聊天变量中存储的正则名称列表
    const getStoredRegexNames = () => {
        try {
            const chatVars = getVariables({ type: 'chat' });
            const stored = chatVars?.[VARIABLE_KEY];
            if (Array.isArray(stored)) {
                return stored.filter((item) => typeof item === 'string');
            }
        }
        catch (e) {
            console.warn('获取存储的正则名称失败:', e);
        }
        return [];
    };
    // 保存正则名称列表到聊天变量（排序后）
    const saveStoredRegexNames = (names) => {
        try {
            // 排序保证一致性
            const sortedNames = [...names].sort();
            insertOrAssignVariables({ [VARIABLE_KEY]: sortedNames }, { type: 'chat' });
            console.info(`自适应正则: 已保存 ${sortedNames.length} 个正则名称到聊天变量`);
        }
        catch (e) {
            console.warn('保存正则名称失败:', e);
            throw e;
        }
    };
    // 获取角色卡当前已注册的所有正则 scriptName
    const getCharacterCardRegexNames = async () => {
        const names = new Set();
        const regexes = getTavernRegexes({ type: 'character' });
        regexes.forEach(r => names.add(r.script_name));
        return names;
    };
    // 注册单个正则规则
    const registerRegexRule = async (rule) => {
        try {
            await updateTavernRegexesWith((regexes) => {
                // 避免重复注册同名正则
                const filtered = regexes.filter((r) => r.script_name !== rule.script_name);
                return [...filtered, rule];
            }, { type: 'character' });
            automaticallyRegisteredNames.add(rule.script_name);
        }
        catch (e) {
            console.warn(`注册正则失败: ${rule.script_name}`, e);
            throw e;
        }
    };
    // 同步正则列表：对比变量列表和角色卡正则列表
    // - 移除：存在于角色卡正则列表但不在变量列表中的正则
    // - 注册：存在于变量列表但不在角色卡正则列表中的正则
    const syncRegexWithVariable = async () => {
        // 防止重复调用
        if (isSyncing) {
            console.info('自适应正则: 正在同步中，跳过本次调用');
            return;
        }
        try {
            isSyncing = true;
            const variableNames = getStoredRegexNames();
            const variableSet = new Set(variableNames);
            const characterCardNames = await getCharacterCardRegexNames();
            const characterSet = new Set(characterCardNames);
            // 获取所有启用状态的 regex.json 规则名称（用于判断是否应该移除）
            const enabledRegexNames = new Set(getEnabledRegexRules().map(r => r.script_name));
            // 找出需要移除的正则（同时满足两个条件：1. 在regex.json中启用 2. 不在变量列表中）
            const toRemove = [];
            for (const name of characterCardNames) {
                // 只有当该正则是在regex.json中启用着的，且不在变量列表中时才移除
                if (!variableSet.has(name) && enabledRegexNames.has(name)) {
                    toRemove.push(name);
                }
            }
            // 找出需要注册的正则（在变量中但不在角色卡中）
            const toRegister = [];
            for (const name of variableNames) {
                if (!characterSet.has(name)) {
                    toRegister.push(name);
                }
            }
            // 执行移除
            if (toRemove.length > 0) {
                await removeRegexByNames(toRemove);
                console.info(`自适应正则: 已移除 ${toRemove.length} 条不在变量列表中的规则: ${toRemove.join(', ')}`);
            }
            // 执行注册
            if (toRegister.length > 0) {
                const allRules = getEnabledRegexRules();
                let registeredCount = 0;
                for (const name of toRegister) {
                    const rule = allRules.find(r => r.script_name === name);
                    if (rule) {
                        await registerRegexRule(rule);
                        registeredCount++;
                        console.info(`自适应正则: 已注册 ${name}`);
                    }
                }
                if (registeredCount > 0) {
                    console.info(`自适应正则: 共注册了 ${registeredCount} 条规则`);
                }
            }
            if (toRemove.length === 0 && toRegister.length === 0) {
                console.info('自适应正则: 变量列表与角色卡正则列表已同步，无需更新');
            }
        }
        catch (e) {
            console.error('同步正则列表失败:', e);
        }
        finally {
            isSyncing = false;
        }
    };
    // 移除指定名称的正则
    const removeRegexByNames = async (names) => {
        if (names.length === 0)
            return;
        try {
            await updateTavernRegexesWith((regexes) => {
                return regexes.filter((r) => !names.includes(r.script_name));
            }, { type: 'character' });
            console.info(`自适应正则: 已移除 ${names.length} 条规则`);
        }
        catch (e) {
            console.warn('移除正则失败:', e);
        }
    };
    // 扫描最后一层消息并更新变量
    const scanAndUpdateVariable = async () => {
        try {
            console.info('自适应正则: 开始扫描最后一层消息');
            const messages = getChatMessages(-1); // 获取最后一条消息
            console.info('自适应正则: 获取到的消息:', messages);
            if (!messages || messages.length === 0) {
                console.info('自适应正则: 没有找到消息，同步已存储的规则');
                await syncRegexWithVariable();
                return;
            }
            const lastMessage = messages[0];
            const messageContent = lastMessage.message;
            console.info('自适应正则: 消息内容:', messageContent);
            // 获取已存储的名称，用于跳过检测
            const storedNames = getStoredRegexNames();
            console.info('自适应正则: 已存储的正则名称:', storedNames);
            // 检测需要的正则名称（跳过已存储的正则）
            const detectedNames = detectNeededScriptNames(messageContent, storedNames);
            console.info('自适应正则: 检测到的新正则名称:', detectedNames);
            // 合并并去重
            const combinedNames = [...new Set([...storedNames, ...detectedNames])];
            console.info('自适应正则: 合并后的正则名称:', combinedNames);
            // 如果有变化，保存并同步
            const storedSorted = [...storedNames].sort().join(',');
            const combinedSorted = [...combinedNames].sort().join(',');
            console.info('自适应正则: 排序后的存储名称:', storedSorted);
            console.info('自适应正则: 排序后的合并名称:', combinedSorted);
            if (storedSorted !== combinedSorted) {
                console.info(`自适应正则: 检测到变化，从 ${storedNames.length} 个更新到 ${combinedNames.length} 个`);
                saveStoredRegexNames(combinedNames);
                await syncRegexWithVariable();
            }
            else {
                // 上次注册可能失败：名称未变化时仍尝试补齐角色卡内缺失的正则。
                await syncRegexWithVariable();
            }
        }
        catch (e) {
            console.error('扫描消息更新变量失败:', e);
        }
    };
    // 监听变量变化的事件回调
    let previousStoredNames = [];
    const watchVariableChange = () => {
        // 初始记录
        previousStoredNames = getStoredRegexNames();
        // 重写 replaceVariables 函数来监听变量变化
        const originalReplaceVariables = replaceVariables;
        window.replaceVariables = function (variables, option) {
            const result = originalReplaceVariables.call(this, variables, option);
            // 检查是否是聊天变量发生变化，且不在同步中
            if (!isSyncing && (option?.type === 'chat' || !option)) {
                const currentStoredNames = getStoredRegexNames();
                const currentSorted = [...currentStoredNames].sort().join(',');
                const previousSorted = [...previousStoredNames].sort().join(',');
                if (currentSorted !== previousSorted) {
                    console.info(`自适应正则: 变量发生变化，刷新正则列表`);
                    // 使用防抖，避免频繁触发
                    if (syncTimeout) {
                        clearTimeout(syncTimeout);
                    }
                    syncTimeout = setTimeout(() => {
                        syncRegexWithVariable().then(() => {
                            previousStoredNames = getStoredRegexNames();
                        });
                    }, 500);
                }
            }
            return result;
        };
    };
    const forceUpdateSystemBeautifiers = async () => {
        if (isSyncing) {
            toastr.info('美化规则正在更新，请稍后再试');
            return;
        }
        isSyncing = true;
        try {
            const chatId = SillyTavern.getCurrentChatId();
            const characterId = SillyTavern.characterId;
            const characterName = SillyTavern.characters[Number(characterId)]?.avatar;
            if (!chatId || !characterName) {
                toastr.warning('请先打开角色聊天，再更新美化规则');
                return;
            }
            const presetName = SillyTavern.getPresetManager('openai').getSelectedPresetName();
            const characterOption = { type: 'character', name: characterName };
            const core = getVariables({ type: 'chat' }).系统核心;
            if (typeof core !== 'string' || !core.trim()) {
                toastr.warning('聊天中还没有系统核心，请先选择系统核心后重试');
                return;
            }
            const targetRules = getEnabledRegexRules().filter(rule => matchesSystemCore(rule.script_name, core));
            if (targetRules.length === 0) {
                toastr.warning(`暂未找到「${core}」对应的美化规则，请检查系统核心名称`);
                return;
            }
            const scopes = ['character', 'global', 'preset'];
            const scopeLabels = { character: '角色卡', global: '全局', preset: '预设' };
            const conflicts = scopes.flatMap(type => getTavernRegexes(type === 'character' ? characterOption : { type }).filter(rule => isSystemBeautifier(rule.script_name)
                && !(type === 'character' && targetRules.some(target => target.id === rule.id || target.script_name === rule.script_name))).map(rule => ({ ...rule, type })));
            let action = 'keep';
            if (conflicts.length > 0) {
                const result = await SillyTavern.callGenericPopup(`<h3>强制更新美化</h3><p>当前系统核心：${_.escape(core)}。将重装 ${targetRules.length} 条对应规则。</p>`
                    + '<p>对应规则会安装到当前角色卡。停用或删除全局、预设规则，也会影响其他使用这些规则的聊天。</p>'
                    + '<p>还发现以下系统美化规则，请选择如何处理：</p><ul>'
                    + conflicts.map(rule => `<li>${_.escape(rule.script_name)}（${scopeLabels[rule.type]}，${rule.enabled ? '已启用' : '已停用'}）</li>`).join('')
                    + '</ul><p>你的选择会应用到上面列出的所有规则。</p>', SillyTavern.POPUP_TYPE.TEXT, '', {
                    okButton: '保留并更新', cancelButton: '取消',
                    customButtons: [
                        { text: '停用并更新', result: SillyTavern.POPUP_RESULT.CUSTOM1 },
                        { text: '删除并更新', result: SillyTavern.POPUP_RESULT.CUSTOM2 },
                    ],
                    defaultResult: SillyTavern.POPUP_RESULT.CANCELLED,
                    allowVerticalScrolling: true,
                });
                if (result === SillyTavern.POPUP_RESULT.CUSTOM1)
                    action = 'disable';
                else if (result === SillyTavern.POPUP_RESULT.CUSTOM2)
                    action = 'remove';
                else if (result !== SillyTavern.POPUP_RESULT.AFFIRMATIVE)
                    return;
            }
            if (SillyTavern.getCurrentChatId() !== chatId || SillyTavern.characterId !== characterId
                || getVariables({ type: 'chat' }).系统核心 !== core
                || SillyTavern.getPresetManager('openai').getSelectedPresetName() !== presetName) {
                toastr.warning('聊天、预设或系统核心已改变，请重新点击强制更新美化');
                return;
            }
            const applyChoice = (regexes, type) => regexes.flatMap(rule => {
                if (action === 'keep' || !conflicts.some(other => other.type === type && other.id === rule.id && other.script_name === rule.script_name)) {
                    return [rule];
                }
                return action === 'remove' ? [] : [{ ...rule, enabled: false }];
            });
            const updated = await updateTavernRegexesWith(regexes => [
                ...applyChoice(regexes, 'character').filter(rule => !targetRules.some(target => target.id === rule.id || target.script_name === rule.script_name)),
                ...targetRules,
            ], characterOption);
            if (SillyTavern.getCurrentChatId() !== chatId || SillyTavern.characterId !== characterId
                || getVariables({ type: 'chat' }).系统核心 !== core) {
                throw new Error('更新期间聊天或系统核心改变，已停止后续操作');
            }
            for (const rule of [...targetRules, ...conflicts.filter(rule => rule.type === 'character')]) {
                automaticallyRegisteredNames.delete(rule.script_name);
            }
            const catalogueNames = new Set(getEnabledRegexRules().map(rule => rule.script_name));
            saveStoredRegexNames([...new Set([
                    ...getStoredRegexNames().filter(name => !isSystemBeautifier(name)),
                    ...updated.filter(rule => catalogueNames.has(rule.script_name)).map(rule => rule.script_name),
                ])]);
            if (action !== 'keep') {
                for (const type of ['global', 'preset']) {
                    if (conflicts.some(rule => rule.type === type)) {
                        if (SillyTavern.getPresetManager('openai').getSelectedPresetName() !== presetName) {
                            throw new Error('更新期间预设改变，已停止后续操作');
                        }
                        await updateTavernRegexesWith(regexes => applyChoice(regexes, type), { type });
                    }
                }
            }
            toastr.success(`已更新「${core}」的 ${targetRules.length} 条美化规则`);
        }
        catch (error) {
            console.error('强制更新美化失败:', error);
            toastr.error('美化更新未完成，请重试；已经完成的修改会保留');
        }
        finally {
            isSyncing = false;
        }
    };
    appendInexistentScriptButtons([{ name: '强制更新美化', visible: true }]);
    eventOn(getButtonEvent('强制更新美化'), forceUpdateSystemBeautifiers);
    // 监听新消息事件（AI输出完成时）
    eventOn(tavern_events.MESSAGE_RECEIVED, async (messageId) => {
        // 检查是否已经处理过此消息
        const lastProcessedId = getVariables({ type: 'chat' })[LAST_PROCESSED_MESSAGE_ID_KEY];
        if (lastProcessedId !== undefined && lastProcessedId !== null && String(lastProcessedId) === String(messageId)) {
            console.info(`自适应正则: 消息 ${messageId} 已处理过，跳过`);
            return;
        }
        console.info(`自适应正则: 收到新消息 ${messageId}，扫描最新楼层`);
        await scanAndUpdateVariable();
        // 更新最后处理的消息ID
        try {
            insertOrAssignVariables({ [LAST_PROCESSED_MESSAGE_ID_KEY]: messageId }, { type: 'chat' });
            console.info(`自适应正则: 已更新最后处理的消息ID为 ${messageId}`);
        }
        catch (e) {
            console.warn('更新最后处理的消息ID失败:', e);
        }
    });
    // 监听聊天切换事件（带防抖）
    eventOn(tavern_events.CHAT_CHANGED, async (chatFileName) => {
        console.info(`自适应正则: 检测到聊天切换到 ${chatFileName}`);
        // 忽略相同的聊天ID
        if (lastChatId === chatFileName) {
            return;
        }
        lastChatId = chatFileName;
        // 清除之前的定时器
        if (syncTimeout) {
            clearTimeout(syncTimeout);
        }
        // 防抖：延迟 500ms 执行同步
        syncTimeout = setTimeout(async () => {
            if (!isSyncing) {
                await scanAndUpdateVariable();
            }
        }, 500);
    });
    // 卸载时移除所有本脚本注册的正则
    $(window).on('pagehide', async () => {
        const registeredNames = [...automaticallyRegisteredNames];
        if (registeredNames.length > 0) {
            await removeRegexByNames(registeredNames);
            console.info(`自适应正则: 已卸载 ${registeredNames.length} 条自动注册的规则`);
        }
        console.info('自适应正则脚本已卸载');
    });
    // 启动
    console.info('自适应正则: 启动初始化');
    await scanAndUpdateVariable();
    watchVariableChange();
    const enabledRules = regexData.filter((r) => !r.disabled).length;
    console.info(`自适应正则: 准备了 ${enabledRules} 条规则用于检测`);
});

/******/ })()
;
//# sourceMappingURL=index.js.map